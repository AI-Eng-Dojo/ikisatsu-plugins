// プラグイン同梱の MCP の中継。Claude Code / Codex とは stdio(1 行 1 メッセージの JSON-RPC)で話し、
// 1 メッセージずつ https://api.ikisatsu.dev/mcp に POST する。トークンは毎回読み直す
// (ログインし直せばそのまま効く。環境変数の古いトークンで 401 なら ~/.ikisatsu/token で 1 回だけ送り直す。#103 と同じ)。
// stdout は JSON-RPC 専用。本文・トークンは stderr にも出さない

import { createInterface } from "node:readline";
import { apiBaseUrl, findProjectConfig } from "../lib/config.ts";
import type { HookDeps } from "../lib/hook-context.ts";
import { type HttpResult, request } from "../lib/http.ts";
import { readTokenWithSource, type TokenSource } from "../lib/token.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const HOOK = "mcp";
const LOGIN_MESSAGE =
  "ikisatsu にログインしていないか、トークンが無効です。「ikisatsu にログインして」と頼んでログインし直してください";

type JsonRpcId = string | number | null;

const rpcError = (id: JsonRpcId, code: number, message: string) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** tools/call で projectId が無ければ、cwd から辿った .ikisatsu.json の値を足す */
async function withDefaultProjectId(
  msg: Record<string, unknown>,
  cwd: string,
): Promise<Record<string, unknown>> {
  if (msg.method !== "tools/call") return msg;
  const params = asRecord(msg.params) ?? {};
  const args = asRecord(params.arguments) ?? {};
  if (typeof args.projectId === "string") return msg;
  const project = await findProjectConfig(cwd);
  if (project === null) return msg;
  return { ...msg, params: { ...params, arguments: { ...args, projectId: project.projectId } } };
}

/**
 * 1 行(JSON-RPC のメッセージ 1 つ)を中継し、stdout に書く 1 行を返す。通知なら null。
 * 失敗(ログインしていない・接続できない・サーバのエラー)は例外にせず JSON-RPC のエラーにする
 */
export async function forwardMcpMessage(line: string, deps: HookDeps): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return rpcError(null, -32700, "JSON として読めません");
  }
  const msg = asRecord(parsed);
  if (msg === null) return rpcError(null, -32600, "JSON-RPC のメッセージではありません");
  const rawId = msg.id;
  const isNotification = rawId === undefined || rawId === null;
  const id: JsonRpcId = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
  const reply = (text: string) => (isNotification ? null : text);

  const token = await readTokenWithSource(deps.env, deps.home);
  if (token === null) return reply(rpcError(id, -32001, LOGIN_MESSAGE));

  const body = await withDefaultProjectId(msg, deps.cwd);
  const url = `${apiBaseUrl(deps.env)}/mcp`;
  const send = (t: string, source: TokenSource) =>
    request({
      method: "POST",
      url,
      token: t,
      body,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      fetchImpl: deps.fetchImpl,
      diagnostics: { home: deps.home, hook: HOOK, tokenSource: source },
    });

  let res: HttpResult;
  try {
    res = await send(token.token, token.source);
    if (res.status === 401 && token.source === "env") {
      const fromFile = await readTokenWithSource({}, deps.home);
      if (fromFile !== null && fromFile.token !== token.token) {
        res = await send(fromFile.token, fromFile.source);
      }
    }
  } catch {
    return reply(rpcError(id, -32002, "ikisatsu の API に接続できませんでした"));
  }

  if (res.status === 202) return null;
  if (res.status === 401) return reply(rpcError(id, -32001, LOGIN_MESSAGE));
  // サーバは JSON-RPC のエラーも JSON で返す(400 の -32700 など)。そのまま渡す
  if (asRecord(res.json)?.jsonrpc === "2.0") return reply(JSON.stringify(res.json));
  return reply(rpcError(id, -32003, `ikisatsu の API がエラーを返しました(HTTP ${res.status})`));
}

/** stdin を 1 行ずつ中継する。stdin が閉じたら、送り途中のものを待って終える */
export async function runMcpProxy(deps: HookDeps): Promise<void> {
  const pending = new Set<Promise<void>>();
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    const p = forwardMcpMessage(line, deps)
      .then((out) => {
        if (out !== null) process.stdout.write(`${out}\n`);
      })
      .catch(() => {
        // forwardMcpMessage は投げない想定。万一でも中継を止めない
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  }
  await Promise.all(pending);
}
