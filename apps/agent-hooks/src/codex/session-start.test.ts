import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFailOpen } from "../lib/fail-open.ts";
import { makeSandbox, type Sandbox, startServer, type TestServer } from "../testing/sandbox.ts";
import { CODEX_SESSION_START_MAX_CHARS, handleSessionStart } from "./session-start.ts";

const SESSION = "sess-1234abcd";
let sandbox: Sandbox | undefined;
let server: TestServer | undefined;
let logged: string[];

const digest = {
  memberId: "m1",
  displayName: "Niida",
  headline: "認証の実装中",
  body: "### タスクの全体像\nログインを作る",
  updatedAt: "2026-09-29T05:05:00.000Z",
  isMine: true,
};

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  sandbox?.cleanup();
  await server?.close();
  sandbox = undefined;
  server = undefined;
});

describe("handleSessionStart", () => {
  it("GET /v1/digests?projectId= して、additionalContext を含む JSON を 1 個だけ出力する", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ json: { digests: [digest] } }));

    await handleSessionStart(
      { session_id: SESSION, cwd: sandbox.repo, source: "startup" },
      sandbox.deps(server.url),
    );

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/digests?projectId=test-project",
    });
    expect(server.requests[0]?.headers.authorization).toBe("Bearer iks_test-token");
    expect(logged).toHaveLength(1);
    const out = JSON.parse(logged[0] ?? "");
    expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("ikisatsu");
    expect(out.hookSpecificOutput.additionalContext).toContain("認証の実装中");
    expect(out.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(
      CODEX_SESSION_START_MAX_CHARS,
    );
  });

  it("maxChars を超える分は落とす", async () => {
    sandbox = makeSandbox();
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...digest,
      memberId: `m${i}`,
      isMine: i === 0,
      updatedAt: `2026-09-29T05:0${i}:00.000Z`,
      body: "あ".repeat(1500),
    }));
    server = await startServer(() => ({ json: { digests: many } }));
    await handleSessionStart({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    const out = JSON.parse(logged[0] ?? "");
    expect(out.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(
      CODEX_SESSION_START_MAX_CHARS,
    );
  });

  it("0 件のときは何も出力しない", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ json: { digests: [] } }));
    await handleSessionStart({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    expect(logged).toEqual([]);
  });

  it("サーバが 500 / 不正な応答のときは何も出力せず例外にもしない", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ status: 500 }));
    await handleSessionStart({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    await server.close();

    for (const json of [
      { digests: "no" },
      { nope: 1 },
      null,
      { digests: [{ headline: 1 }, 5, null] },
    ]) {
      server = await startServer(() => ({ json }));
      await handleSessionStart(
        { session_id: SESSION, cwd: sandbox.repo },
        sandbox.deps(server.url),
      );
      await server.close();
    }
    expect(logged).toEqual([]);
  });

  it("タイムアウトしても runFailOpen 経由で exit 0、何も出力しない", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ delayMs: 500, json: { digests: [digest] } }));
    const sb = sandbox;
    const url = server.url;
    const codes: number[] = [];
    await runFailOpen(
      () =>
        handleSessionStart(
          { session_id: SESSION, cwd: sb.repo },
          { ...sb.deps(url), timeoutMs: 50 },
        ),
      { exit: (c) => codes.push(c), deadlineMs: 5000 },
    );
    expect(codes).toEqual([0]);
    expect(logged).toEqual([]);
  });

  it(".ikisatsu.json / トークンが無ければ何も送らず何も出力しない", async () => {
    server = await startServer(() => ({ json: { digests: [digest] } }));
    sandbox = makeSandbox({ project: null });
    await handleSessionStart({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    sandbox.cleanup();
    sandbox = makeSandbox({ token: null });
    await handleSessionStart({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    await handleSessionStart(null, sandbox.deps(server.url));
    expect(server.requests).toHaveLength(0);
    expect(logged).toEqual([]);
  });

  it("session_id が無くても動く(注入に session_id は要らない)", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ json: { digests: [digest] } }));
    await handleSessionStart({ cwd: sandbox.repo }, sandbox.deps(server.url));
    expect(logged).toHaveLength(1);
  });
});

describe("長期の記憶(ルールと最近の決定)の注入", () => {
  const domain = {
    rules: [{ name: "テストを先に書く", statement: "実装の前にテストを書く" }],
    decisions: [
      {
        name: "Hono を使う",
        rationale: "軽いから",
        decidedAt: "2026-10-05T12:00:00.000Z",
        displayName: "太郎",
      },
    ],
  };
  const contextOf = () =>
    JSON.parse(logged[0] ?? "").hookSpecificOutput.additionalContext as string;

  it("応答に domain があると、短期の記憶の後ろにルールと最近の決定が入る", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ json: { digests: [digest], domain } }));
    await handleSessionStart({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    const text = contextOf();
    expect(text).toContain("認証の実装中");
    expect(text).toContain("### ルール\n- テストを先に書く: 実装の前にテストを書く");
    expect(text).toContain("- 2026-10-05 Hono を使う(太郎)— 軽いから");
    expect(text.indexOf("認証の実装中")).toBeLessThan(text.indexOf("テストを先に書く"));
    expect(text.length).toBeLessThanOrEqual(CODEX_SESSION_START_MAX_CHARS);
  });

  it("digests が 0 件でも、ルールと決定があれば注入する", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ json: { digests: [], domain } }));
    await handleSessionStart({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    expect(logged).toHaveLength(1);
    expect(contextOf()).toContain("テストを先に書く");
  });

  it("古いサーバ(domain が無い)・domain が null・空のときは、今までと同じ文面", async () => {
    sandbox = makeSandbox();
    const texts: string[] = [];
    for (const extra of [{}, { domain: null }, { domain: { rules: [], decisions: [] } }]) {
      logged = [];
      server = await startServer(() => ({ json: { digests: [digest], ...extra } }));
      await handleSessionStart(
        { session_id: SESSION, cwd: sandbox.repo },
        sandbox.deps(server.url),
      );
      await server.close();
      texts.push(contextOf());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).not.toContain("ルール");
  });

  it("domain が壊れていたら無視して、短期の記憶だけを注入する(fail-open)", async () => {
    sandbox = makeSandbox();
    const broken = [
      "no",
      { rules: "x", decisions: [] },
      { rules: [], decisions: {} },
      { rules: [{ name: 1, statement: "a" }], decisions: [] },
      { rules: [null], decisions: [] },
      { rules: [], decisions: [{ name: "a", rationale: "b", decidedAt: 1, displayName: null }] },
      { rules: [], decisions: [{ name: "a", rationale: "b", decidedAt: "x", displayName: 3 }] },
    ];
    for (const d of broken) {
      logged = [];
      server = await startServer(() => ({ json: { digests: [digest], domain: d } }));
      await handleSessionStart(
        { session_id: SESSION, cwd: sandbox.repo },
        sandbox.deps(server.url),
      );
      await server.close();
      expect(contextOf()).toContain("認証の実装中");
      expect(contextOf()).not.toContain("長期の記憶");
    }
  });

  it("ルールが多いときも、全体は上限に収まる", async () => {
    sandbox = makeSandbox();
    const many = {
      rules: Array.from({ length: 100 }, (_, i) => ({
        name: `ルール${i}`,
        statement: "あ".repeat(80),
      })),
      decisions: domain.decisions,
    };
    server = await startServer(() => ({ json: { digests: [digest], domain: many } }));
    await handleSessionStart({ session_id: SESSION, cwd: sandbox.repo }, sandbox.deps(server.url));
    const text = contextOf();
    expect(text.length).toBeLessThanOrEqual(CODEX_SESSION_START_MAX_CHARS);
    expect(text).toContain("認証の実装中");
    expect(text).toMatch(/他 \d+ 件のルール/);
  });
});
