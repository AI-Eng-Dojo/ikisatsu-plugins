// テスト用の道具: 一時 HOME / リポジトリ、ローカルの API サーバ(受けたリクエストを記録する)

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookDeps } from "../lib/hook-context.ts";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface Reply {
  status?: number;
  json?: unknown;
  /** JSON ではない本文(HTML や平文のブロックページなど) */
  text?: string;
  /** 応答ヘッダ(cf-ray など) */
  headers?: Record<string, string>;
  /** 応答を遅らせる(タイムアウトのテスト用) */
  delayMs?: number;
}

export interface TestServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

export async function startServer(
  reply: (req: RecordedRequest) => Reply = () => ({}),
): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf-8"),
      };
      requests.push(recorded);
      const r = reply(recorded);
      setTimeout(() => {
        res.statusCode = r.status ?? (r.json === undefined && r.text === undefined ? 204 : 200);
        for (const [name, value] of Object.entries(r.headers ?? {})) res.setHeader(name, value);
        if (r.json !== undefined) {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(r.json));
        } else if (r.text !== undefined) {
          res.end(r.text);
        } else {
          res.end();
        }
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface Sandbox {
  home: string;
  /** .ikisatsu.json を置いた(または置いていない)リポジトリ */
  repo: string;
  deps: (apiUrl: string, extraEnv?: NodeJS.ProcessEnv) => HookDeps;
  writeTranscript: (jsonl: string) => string;
  cleanup: () => void;
}

export function makeSandbox(
  options: { project?: string | null; token?: string | null } = {},
): Sandbox {
  const { project = "test-project", token = "iks_test-token" } = options;
  const root = mkdtempSync(join(tmpdir(), "ikisatsu-test-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  mkdirSync(home);
  mkdirSync(join(repo, "sub"), { recursive: true });
  if (project !== null) {
    writeFileSync(join(repo, ".ikisatsu.json"), JSON.stringify({ projectId: project }));
  }
  if (token !== null) {
    mkdirSync(join(home, ".ikisatsu"));
    writeFileSync(join(home, ".ikisatsu", "token"), `${token}\n`);
  }
  return {
    home,
    repo,
    deps: (apiUrl, extraEnv = {}) => ({
      env: { IKISATSU_API_URL: apiUrl, ...extraEnv },
      home,
      cwd: repo,
    }),
    writeTranscript: (jsonl) => {
      const path = join(root, "transcript.jsonl");
      writeFileSync(path, jsonl);
      return path;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
