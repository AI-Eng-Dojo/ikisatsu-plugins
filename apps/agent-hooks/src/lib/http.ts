// タイムアウト付きの HTTP。例外(タイムアウト・接続失敗)は投げる。呼び出し側(fail-open ラッパ)が握る。
// 本文・トークンはどこにも出力しない。diagnostics があるときだけ、失敗の手がかり
// (状態・Cloudflare 系のヘッダ・応答本文の先頭)を ~/.ikisatsu/logs に残す

import { appendHttpFailure } from "./diag-log.ts";
import type { TokenSource } from "./token.ts";

/** 全リクエストの User-Agent。Node 既定の UA を固定し、WAF 側でこのフックを見分けられるようにする */
export const USER_AGENT = "ikisatsu-hooks";
const BODY_HEAD_CHARS = 300;

export interface RequestOptions {
  method: "GET" | "POST" | "PUT";
  url: string;
  /** Bearer トークン。login の exchange のように資格が別のときは省略する */
  token?: string;
  body?: unknown;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  /** 渡すと、失敗(非 2xx・接続失敗・タイムアウト)を ~/.ikisatsu/logs/http-errors.log に残す */
  diagnostics?: { home: string; hook: string; tokenSource?: TokenSource };
}

export interface HttpResult {
  status: number;
  ok: boolean;
  /** 本文を JSON として読めたときだけ。読めなければ undefined */
  json: unknown;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function isControl(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029;
}

/** 制御文字・改行を空白にして先頭だけ。1 行のログに収める */
function bodyHead(text: string): string {
  return Array.from(text.slice(0, BODY_HEAD_CHARS), (ch) => (isControl(ch) ? " " : ch)).join("");
}

export async function request(options: RequestOptions): Promise<HttpResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "user-agent": USER_AGENT };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const { diagnostics } = options;
  let res: Response;
  try {
    res = await doFetch(options.url, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (err) {
    if (diagnostics) {
      const e = err instanceof Error ? err : undefined;
      const cause = (e?.cause ?? undefined) as { code?: unknown } | undefined;
      await appendHttpFailure(diagnostics.home, {
        at: new Date().toISOString(),
        hook: diagnostics.hook,
        method: options.method,
        path: pathOf(options.url),
        tokenSource: diagnostics.tokenSource,
        error: e?.name ?? "UnknownError",
        code: typeof cause?.code === "string" ? cause.code : undefined,
      });
    }
    throw err;
  }

  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (!res.ok && diagnostics) {
    await appendHttpFailure(diagnostics.home, {
      at: new Date().toISOString(),
      hook: diagnostics.hook,
      method: options.method,
      path: pathOf(options.url),
      tokenSource: diagnostics.tokenSource,
      status: res.status,
      cfRay: res.headers.get("cf-ray"),
      server: res.headers.get("server"),
      cfMitigated: res.headers.get("cf-mitigated"),
      contentType: res.headers.get("content-type"),
      bodyHead: bodyHead(text),
    });
  }
  return { status: res.status, ok: res.ok, json };
}
