// 送信の失敗を ~/.ikisatsu/logs/http-errors.log に残す診断(403 の出どころの切り分け)。
// 残すのは状態コードと Cloudflare 系のヘッダ・応答本文の先頭だけ。リクエスト本文・トークンは残さない

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSessionEnd } from "../claude-code/session-end.ts";
import { handleSessionStart as claudeSessionStart } from "../claude-code/session-start.ts";
import { handleStop } from "../claude-code/stop.ts";
import { handleSessionStart as codexSessionStart } from "../codex/session-start.ts";
import { makeSandbox, type Sandbox, startServer, type TestServer } from "../testing/sandbox.ts";
import { runFailOpen } from "./fail-open.ts";

const SESSION = "sess-1234abcd";
const at = "2026-09-29T01:02:03.000Z";
const TOKEN = "iks_test-token";

const transcript = [
  { type: "user", timestamp: at, message: { content: "ひみつの依頼-USER-TEXT" } },
  {
    type: "assistant",
    timestamp: at,
    message: {
      content: [
        { type: "thinking", thinking: "SECRET-THOUGHT" },
        { type: "text", text: "ひみつの返答-ASSISTANT-TEXT" },
      ],
    },
  },
];
const jsonl = () => transcript.map((l) => JSON.stringify(l)).join("\n");

const BLOCK = {
  status: 403,
  headers: { "cf-ray": "test-ray-NRT", server: "cloudflare", "content-type": "text/plain" },
  text: "error code: 1010",
};

let sandbox: Sandbox | undefined;
let server: TestServer | undefined;
let stdout: string[];

beforeEach(() => {
  stdout = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  sandbox?.cleanup();
  await server?.close();
  sandbox = undefined;
  server = undefined;
});

const logPath = (home: string) => join(home, ".ikisatsu", "logs", "http-errors.log");
const readLines = (home: string) =>
  readFileSync(logPath(home), "utf-8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

async function stopWith(reply: Parameters<typeof startServer>[0]) {
  sandbox = makeSandbox();
  server = await startServer(reply);
  const sb = sandbox;
  const path = sb.writeTranscript(jsonl());
  await handleStop(
    { session_id: SESSION, transcript_path: path, cwd: sb.repo },
    sb.deps(server.url),
  );
  return sb;
}

describe("送信失敗の診断ログ", () => {
  it("Stop が 403 でも例外にならず、状態・cf-ray・本文の先頭・hook・method・path が 1 行残る", async () => {
    const sb = await stopWith(() => BLOCK);

    const lines = readLines(sb.home);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      hook: "claude-code-stop",
      method: "PUT",
      path: `/v1/transcripts/${SESSION}`,
      status: 403,
      cfRay: "test-ray-NRT",
      server: "cloudflare",
      bodyHead: "error code: 1010",
      contentType: "text/plain",
    });
    expect(typeof lines[0]?.at).toBe("string");
  });

  it("negative: ログに発言・トークン・authorization・送信禁止の文字列が入らない", async () => {
    const sb = await stopWith(() => BLOCK);
    const raw = readFileSync(logPath(sb.home), "utf-8");
    for (const secret of [
      "ひみつの依頼",
      "ひみつの返答",
      "SECRET-THOUGHT",
      TOKEN,
      "iks_",
      "Bearer",
      "projectId",
      "test-project",
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw.toLowerCase()).not.toContain("authorization");
  });

  it("成功(204)ならログファイルを作らない", async () => {
    const sb = await stopWith(() => ({}));
    expect(existsSync(join(sb.home, ".ikisatsu", "logs"))).toBe(false);
  });

  it("改行入り 5000 字の HTML の 403 でも、bodyHead は 300 字以下で改行なし・ログは 1 行", async () => {
    const html = `<html>\n<body>\r\n${"あ\n".repeat(2500)}</body></html>`;
    const sb = await stopWith(() => ({
      status: 403,
      headers: { "content-type": "text/html" },
      text: html,
    }));
    const raw = readFileSync(logPath(sb.home), "utf-8");
    expect(raw.trimEnd().split("\n")).toHaveLength(1);
    const [line] = readLines(sb.home);
    const head = line?.bodyHead as string;
    expect(head.length).toBeLessThanOrEqual(300);
    expect(head).not.toMatch(/[\r\n]/);
    expect(head.startsWith("<html>")).toBe(true);
  });

  it("接続できなくても fail-open(exit 0)で、ログにはエラー名だけが残り message は残らない", async () => {
    sandbox = makeSandbox();
    const sb = sandbox;
    const path = sb.writeTranscript(jsonl());
    const codes: number[] = [];
    await runFailOpen(
      () =>
        handleStop(
          { session_id: SESSION, transcript_path: path, cwd: sb.repo },
          sb.deps("http://127.0.0.1:1"),
        ),
      { exit: (c) => codes.push(c), deadlineMs: 5000 },
    );
    expect(codes).toEqual([0]);
    const [line] = readLines(sb.home);
    expect(line).toMatchObject({ hook: "claude-code-stop", method: "PUT", error: "TypeError" });
    expect(line).not.toHaveProperty("message");
    expect(readFileSync(logPath(sb.home), "utf-8")).not.toContain("fetch failed");
  });

  it("閉じたポートへの接続は code: ECONNREFUSED が残る", async () => {
    sandbox = makeSandbox();
    const sb = sandbox;
    const closed = await startServer();
    const url = closed.url;
    await closed.close();
    const path = sb.writeTranscript(jsonl());
    await expect(
      handleStop({ session_id: SESSION, transcript_path: path, cwd: sb.repo }, sb.deps(url)),
    ).rejects.toThrow();
    expect(readLines(sb.home)[0]).toMatchObject({ error: "TypeError", code: "ECONNREFUSED" });
  });

  it("タイムアウトでも fail-open(exit 0)で、ログにエラー名が残る", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ delayMs: 500 }));
    const sb = sandbox;
    const path = sb.writeTranscript(jsonl());
    const codes: number[] = [];
    await runFailOpen(
      () =>
        handleStop(
          { session_id: SESSION, transcript_path: path, cwd: sb.repo },
          { ...sb.deps(server?.url ?? ""), timeoutMs: 50 },
        ),
      { exit: (c) => codes.push(c), deadlineMs: 5000 },
    );
    expect(codes).toEqual([0]);
    const [line] = readLines(sb.home);
    expect(line?.error).toBe("TimeoutError");
    expect(line).not.toHaveProperty("message");
  });

  it("ログを書けなくても(logs がファイル)送信は例外にならない", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => BLOCK);
    const sb = sandbox;
    writeFileSync(join(sb.home, ".ikisatsu", "logs"), "ファイル");
    const path = sb.writeTranscript(jsonl());
    await expect(
      handleStop({ session_id: SESSION, transcript_path: path, cwd: sb.repo }, sb.deps(server.url)),
    ).resolves.toBeUndefined();
  });

  it("512KB を超えたら .1 に退避して新しいログを書く(1 世代)", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => BLOCK);
    const sb = sandbox;
    const dir = join(sb.home, ".ikisatsu", "logs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "http-errors.log"), `${"x".repeat(512 * 1024 + 1)}\n`);
    const path = sb.writeTranscript(jsonl());
    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(server.url),
    );
    expect(readdirSync(dir).sort()).toEqual(["http-errors.log", "http-errors.log.1"]);
    expect(statSync(join(dir, "http-errors.log.1")).size).toBeGreaterThan(512 * 1024);
    expect(readLines(sb.home)).toHaveLength(1);
  });

  it("ディレクトリは 0700、ファイルは 0600 で作る", async () => {
    const sb = await stopWith(() => BLOCK);
    expect(statSync(join(sb.home, ".ikisatsu", "logs")).mode & 0o777).toBe(0o700);
    expect(statSync(logPath(sb.home)).mode & 0o777).toBe(0o600);
  });

  it("SessionEnd の失敗は hook 名 claude-code-session-end で残る", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => BLOCK);
    await handleSessionEnd({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    expect(readLines(sandbox.home)[0]).toMatchObject({
      hook: "claude-code-session-end",
      method: "POST",
      path: `/v1/sessions/${SESSION}/end`,
      status: 403,
    });
  });

  it.each([
    ["claude-code-session-start", claudeSessionStart],
    ["codex-session-start", codexSessionStart],
  ])("%s は 403 でも stdout に何も出さず、hook 名が残る", async (hook, handler) => {
    sandbox = makeSandbox();
    server = await startServer(() => BLOCK);
    await handler({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    expect(stdout).toEqual([]);
    expect(readLines(sandbox.home)[0]).toMatchObject({
      hook,
      method: "GET",
      path: "/v1/digests",
      status: 403,
    });
    // クエリ(projectId)は残さない
    expect(readFileSync(logPath(sandbox.home), "utf-8")).not.toContain("test-project");
  });
});

describe("トークンの出どころ(#79)", () => {
  it("IKISATSU_TOKEN で 401 になったら tokenSource: env が残り、値は残らない", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ status: 401, json: { error: { code: "unauthorized" } } }));
    await codexSessionStart(
      { session_id: SESSION, cwd: sandbox.repo },
      sandbox.deps(server.url, { IKISATSU_TOKEN: "iks_stale-env-token" }),
    );
    expect(readLines(sandbox.home)[0]).toMatchObject({ status: 401, tokenSource: "env" });
    const raw = readFileSync(logPath(sandbox.home), "utf-8");
    expect(raw).not.toContain("iks_stale-env-token");
    expect(raw).not.toContain(TOKEN);
  });

  it("~/.ikisatsu/token で失敗したら tokenSource: file が残る", async () => {
    const sb = await stopWith(() => BLOCK);
    expect(readLines(sb.home)[0]).toMatchObject({ tokenSource: "file" });
  });

  it("接続できないときも tokenSource が残る", async () => {
    sandbox = makeSandbox();
    await handleSessionEnd(
      { session_id: SESSION, cwd: sandbox.repo },
      { ...sandbox.deps("http://127.0.0.1:1"), timeoutMs: 2_000 },
    ).catch(() => undefined);
    expect(readLines(sandbox.home)[0]).toMatchObject({ tokenSource: "file" });
  });
});

describe("User-Agent", () => {
  it("stop / session-end / digests のリクエストに user-agent: ikisatsu-hooks が付く", async () => {
    sandbox = makeSandbox();
    server = await startServer((req) =>
      req.path.startsWith("/v1/digests") ? { json: { digests: [] } } : {},
    );
    const sb = sandbox;
    const path = sb.writeTranscript(jsonl());
    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(server.url),
    );
    await handleSessionEnd({ session_id: SESSION, cwd: sb.repo }, sb.deps(server.url));
    await claudeSessionStart({ session_id: SESSION, cwd: sb.repo }, sb.deps(server.url));
    expect(server.requests).toHaveLength(3);
    for (const req of server.requests) {
      expect(req.headers["user-agent"], req.path).toBe("ikisatsu-hooks");
    }
  });
});
