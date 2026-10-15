import { afterEach, describe, expect, it } from "vitest";
import { runFailOpen } from "../lib/fail-open.ts";
import { makeSandbox, type Sandbox, startServer, type TestServer } from "../testing/sandbox.ts";
import { handleSessionEnd } from "./session-end.ts";

const SESSION = "sess-1234abcd";
let sandbox: Sandbox | undefined;
let server: TestServer | undefined;

afterEach(async () => {
  sandbox?.cleanup();
  await server?.close();
  sandbox = undefined;
  server = undefined;
});

describe("handleSessionEnd", () => {
  it("POST /v1/sessions/:sessionId/end を Bearer 付きで送る(本文なし)", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ status: 202 }));
    await handleSessionEnd({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "POST",
      path: `/v1/sessions/${SESSION}/end`,
      body: "",
    });
    expect(server.requests[0]?.headers.authorization).toBe("Bearer iks_test-token");
  });

  it(".ikisatsu.json が無ければ何も送らない", async () => {
    sandbox = makeSandbox({ project: null });
    server = await startServer();
    await handleSessionEnd({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    expect(server.requests).toHaveLength(0);
  });

  it("トークンが無ければ何も送らない", async () => {
    sandbox = makeSandbox({ token: null });
    server = await startServer();
    await handleSessionEnd({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    expect(server.requests).toHaveLength(0);
  });

  it("session_id が不正なら何も送らない", async () => {
    sandbox = makeSandbox();
    server = await startServer();
    await handleSessionEnd(
      { session_id: "bad id/..", cwd: sandbox.repo },
      sandbox.deps(server.url),
    );
    await handleSessionEnd(null, sandbox.deps(server.url));
    expect(server.requests).toHaveLength(0);
  });

  it("500 でも例外にならず、タイムアウトしても exit 0", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ status: 500 }));
    await expect(
      handleSessionEnd({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url)),
    ).resolves.toBeUndefined();

    await server.close();
    server = await startServer(() => ({ delayMs: 500 }));
    const sb = sandbox;
    const url = server.url;
    const codes: number[] = [];
    await runFailOpen(
      () =>
        handleSessionEnd({ session_id: SESSION, cwd: sb.repo }, { ...sb.deps(url), timeoutMs: 50 }),
      { exit: (c) => codes.push(c), deadlineMs: 5000 },
    );
    expect(codes).toEqual([0]);
  });
});
