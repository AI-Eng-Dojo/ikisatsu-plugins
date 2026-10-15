// 環境変数の古いトークンで 401 になったら、~/.ikisatsu/token を読み直して 1 回だけ送り直す(#103)。
// 長生きする Codex のプロセスに古い IKISATSU_TOKEN が残り、ログインし直しても送れなかった

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleSessionStart as claudeSessionStart } from "../claude-code/session-start.ts";
import { handleCodexSessionEnd } from "../codex/session-end.ts";
import { handleCodexStop } from "../codex/stop.ts";
import {
  makeSandbox,
  type RecordedRequest,
  type Sandbox,
  startServer,
  type TestServer,
} from "../testing/sandbox.ts";

const SESSION = "01a110cf-fc7d-7cb3-91b1-a44677b8b571";
const at = "2026-10-06T10:43:48.000Z";
const FILE_TOKEN = "iks_fresh-token";
const STALE_TOKEN = "iks_stale-token";

const rollout = [
  {
    timestamp: at,
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "続けて" }] },
  },
  {
    timestamp: at,
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: { type: "UserMessage", content: [{ type: "text", text: "続けて", text_elements: [] }] },
    },
  },
  {
    timestamp: at,
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "続けました" }],
    },
  },
]
  .map((l) => JSON.stringify(l))
  .join("\n");

let sandbox: Sandbox | undefined;
let server: TestServer | undefined;

afterEach(async () => {
  sandbox?.cleanup();
  await server?.close();
  sandbox = undefined;
  server = undefined;
});

/** FILE_TOKEN だけを通すサーバ */
async function setup(fileToken: string | null = FILE_TOKEN) {
  sandbox = makeSandbox({ token: fileToken });
  server = await startServer((req: RecordedRequest) =>
    req.headers.authorization === `Bearer ${FILE_TOKEN}`
      ? { json: { digests: [] } }
      : { status: 401, json: { error: "unauthorized" } },
  );
  return { sb: sandbox, srv: server };
}

const authsOf = (srv: TestServer) => srv.requests.map((r) => r.headers.authorization);
const logLines = (home: string) =>
  readFileSync(join(home, ".ikisatsu", "logs", "http-errors.log"), "utf-8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("authedRequest: 古い IKISATSU_TOKEN で 401 になったとき", () => {
  it("Codex の Stop は ~/.ikisatsu/token で送り直して届く", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(rollout);

    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url, { IKISATSU_TOKEN: STALE_TOKEN }),
    );

    expect(authsOf(srv)).toEqual([`Bearer ${STALE_TOKEN}`, `Bearer ${FILE_TOKEN}`]);
    expect(srv.requests[1]?.body).toBe(srv.requests[0]?.body);
  });

  it("Codex の SessionEnd は送り直しも要約の合図も ~/.ikisatsu/token で届く", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(rollout);

    await handleCodexSessionEnd(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url, { IKISATSU_TOKEN: STALE_TOKEN }),
    );

    expect(srv.requests.map((r) => [r.method, r.headers.authorization])).toEqual([
      ["PUT", `Bearer ${STALE_TOKEN}`],
      ["PUT", `Bearer ${FILE_TOKEN}`],
      ["POST", `Bearer ${STALE_TOKEN}`],
      ["POST", `Bearer ${FILE_TOKEN}`],
    ]);
  });

  it("SessionStart の注入も ~/.ikisatsu/token で取り直す", async () => {
    const { sb, srv } = await setup();

    await claudeSessionStart(
      { session_id: SESSION, cwd: sb.repo },
      sb.deps(srv.url, { IKISATSU_TOKEN: STALE_TOKEN }),
    );

    expect(authsOf(srv)).toEqual([`Bearer ${STALE_TOKEN}`, `Bearer ${FILE_TOKEN}`]);
  });

  it("診断ログには env の 401 が残り、トークンの値は残らない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(rollout);

    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url, { IKISATSU_TOKEN: STALE_TOKEN }),
    );

    const lines = logLines(sb.home);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 401, tokenSource: "env" });
    const raw = readFileSync(join(sb.home, ".ikisatsu", "logs", "http-errors.log"), "utf-8");
    expect(raw).not.toContain(STALE_TOKEN);
    expect(raw).not.toContain(FILE_TOKEN);
  });
});

describe("authedRequest: 送り直さないとき", () => {
  it("環境変数とファイルが同じトークンなら、401 でも送り直さない", async () => {
    const { sb, srv } = await setup(STALE_TOKEN);
    const path = sb.writeTranscript(rollout);

    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url, { IKISATSU_TOKEN: STALE_TOKEN }),
    );

    expect(authsOf(srv)).toEqual([`Bearer ${STALE_TOKEN}`]);
  });

  it("ファイルが無ければ、401 でも送り直さない", async () => {
    const { sb, srv } = await setup(null);
    const path = sb.writeTranscript(rollout);

    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url, { IKISATSU_TOKEN: STALE_TOKEN }),
    );

    expect(authsOf(srv)).toEqual([`Bearer ${STALE_TOKEN}`]);
  });

  it("ファイルから読んだトークンで 401 なら、送り直さない", async () => {
    const { sb, srv } = await setup(STALE_TOKEN);
    const path = sb.writeTranscript(rollout);

    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );

    expect(authsOf(srv)).toEqual([`Bearer ${STALE_TOKEN}`]);
  });

  it("環境変数のトークンで通れば、1 回だけ送る", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(rollout);

    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url, { IKISATSU_TOKEN: FILE_TOKEN }),
    );

    expect(authsOf(srv)).toEqual([`Bearer ${FILE_TOKEN}`]);
  });

  it("401 以外の失敗(403)では送り直さない", async () => {
    sandbox = makeSandbox({ token: FILE_TOKEN });
    server = await startServer(() => ({ status: 403, text: "error code: 1010" }));
    const path = sandbox.writeTranscript(rollout);

    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sandbox.repo },
      sandbox.deps(server.url, { IKISATSU_TOKEN: STALE_TOKEN }),
    );

    expect(authsOf(server)).toEqual([`Bearer ${STALE_TOKEN}`]);
  });
});
