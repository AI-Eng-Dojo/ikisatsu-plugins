// Codex の Stop / SessionEnd(#82、グリル C4 / C6)。
// Stop: rollout を削って PUT /v1/transcripts/:sessionId(tool: codex)。
// SessionEnd: 最後の会話を送り直してから、要約の合図(POST /v1/sessions/:id/end)

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runFailOpen } from "../lib/fail-open.ts";
import { makeSandbox, type Sandbox, startServer, type TestServer } from "../testing/sandbox.ts";
import { handleCodexSessionEnd } from "./session-end.ts";
import { handleCodexStop } from "./stop.ts";

const SESSION = "01a110cf-fc7d-7cb3-91b1-a44677b8b571";
const at = "2026-10-06T10:43:48.000Z";

function rolloutLines(): unknown[] {
  return [
    {
      timestamp: at,
      type: "session_meta",
      payload: { id: SESSION, base_instructions: { text: "SECRET-BASE" } },
    },
    {
      timestamp: at,
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "SECRET-DEV" }],
      },
    },
    {
      timestamp: at,
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "# AGENTS.md instructions\nSECRET-AGENTS" },
          { type: "input_text", text: "<environment_context>SECRET-ENV</environment_context>" },
        ],
      },
    },
    {
      timestamp: at,
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "設定を直して" }],
      },
    },
    {
      timestamp: at,
      type: "event_msg",
      payload: {
        type: "item_completed",
        item: {
          type: "UserMessage",
          content: [{ type: "text", text: "設定を直して", text_elements: [] }],
        },
      },
    },
    {
      timestamp: at,
      type: "response_item",
      payload: { type: "custom_tool_call", name: "exec", input: "cat .env # iks_SECRET" },
    },
    {
      timestamp: at,
      type: "response_item",
      payload: { type: "custom_tool_call_output", output: "API_KEY=sk-live-LEAK" },
    },
    {
      timestamp: at,
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "直しました" }],
      },
    },
  ];
}
const jsonl = (lines: unknown[] = rolloutLines()) => lines.map((l) => JSON.stringify(l)).join("\n");

let sandbox: Sandbox | undefined;
let server: TestServer | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  sandbox?.cleanup();
  await server?.close();
  sandbox = undefined;
  server = undefined;
});

async function setup(options?: Parameters<typeof makeSandbox>[0]) {
  sandbox = makeSandbox(options);
  server = await startServer();
  return { sb: sandbox, srv: server };
}

/** runFailOpen を通したときの終了コード */
async function exitCodeOf(main: () => Promise<void>): Promise<number | undefined> {
  let code: number | undefined;
  await runFailOpen(main, {
    exit: (c) => {
      code = c;
    },
    deadlineMs: 10_000,
  });
  return code;
}

const bodyOf = (srv: TestServer, i = 0) => JSON.parse(srv.requests[i]?.body ?? "{}");

describe("handleCodexStop: 送る内容", () => {
  it("発言・返答・ツール名だけを tool: codex で PUT する", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl());

    await handleCodexStop(
      {
        session_id: SESSION,
        transcript_path: path,
        cwd: sb.repo,
        last_assistant_message: "直しました",
      },
      sb.deps(srv.url),
    );

    expect(srv.requests).toHaveLength(1);
    const req = srv.requests[0];
    expect(req?.method).toBe("PUT");
    expect(req?.path).toBe(`/v1/transcripts/${SESSION}`);
    expect(req?.headers.authorization).toBe("Bearer iks_test-token");
    const body = bodyOf(srv);
    expect(Object.keys(body).sort()).toEqual(["entries", "projectId", "tool"]);
    expect(body.tool).toBe("codex");
    expect(body.projectId).toBe("test-project");
    expect(body.entries).toEqual([
      { kind: "user", text: "設定を直して", at },
      { kind: "tool", name: "exec", at },
      { kind: "assistant", text: "直しました", at },
    ]);
  });

  it("negative: 送信ボディに差し込み・指示文・コマンド・実行結果が入らない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl());
    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );
    const raw = srv.requests[0]?.body ?? "";
    for (const s of [
      "SECRET-BASE",
      "SECRET-DEV",
      "SECRET-AGENTS",
      "SECRET-ENV",
      "iks_SECRET",
      "cat .env",
      "sk-live-LEAK",
    ]) {
      expect(raw, s).not.toContain(s);
    }
  });

  it("rollout にまだ無い最後の返答を last_assistant_message で補う", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl());
    await handleCodexStop(
      {
        session_id: SESSION,
        transcript_path: path,
        cwd: sb.repo,
        last_assistant_message: "追加の返答",
      },
      sb.deps(srv.url),
    );
    expect(bodyOf(srv).entries.at(-1)).toEqual({ kind: "assistant", text: "追加の返答" });
  });

  it("stdout に何も書かない(Codex の Stop は stdout を判定に使う)", async () => {
    const { sb, srv } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const path = sb.writeTranscript(jsonl());
    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );
    expect(log).not.toHaveBeenCalled();
  });
});

describe("handleCodexStop: 発言が 0 件(形式が変わった, C6)", () => {
  const withoutShown = () =>
    rolloutLines().filter(
      (l) =>
        !(typeof l === "object" && l !== null && (l as { type?: string }).type === "event_msg"),
    );

  it("読めた分(返答・ツール)は送り、診断ログに 1 行残す(本文は残さない)", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(withoutShown()));
    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );

    expect(bodyOf(srv).entries.map((e: { kind: string }) => e.kind)).toEqual(["tool", "assistant"]);
    const logPath = join(sb.home, ".ikisatsu", "logs", "transcript.log");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      hook: "codex-stop",
      warning: "no_user_messages",
      entries: 2,
    });
    expect(readFileSync(logPath, "utf-8")).not.toContain("直しました");
  });

  it("発言があれば診断ログを作らない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl());
    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );
    expect(existsSync(join(sb.home, ".ikisatsu", "logs", "transcript.log"))).toBe(false);
  });
});

describe("handleCodexStop: 何も送らない条件", () => {
  it(".ikisatsu.json が無い / トークンが無い / session_id が不正なら送らない", async () => {
    for (const [opts, sid] of [
      [{ project: null }, SESSION],
      [{ token: null }, SESSION],
      [{}, "bad id!"],
    ] as const) {
      const { sb, srv } = await setup(opts);
      const path = sb.writeTranscript(jsonl());
      await handleCodexStop(
        { session_id: sid, transcript_path: path, cwd: sb.repo },
        sb.deps(srv.url),
      );
      expect(srv.requests).toHaveLength(0);
      sb.cleanup();
      await srv.close();
    }
    sandbox = undefined;
    server = undefined;
  });

  it("transcript_path が null / 無い / 読めないなら送らない", async () => {
    const { sb, srv } = await setup();
    for (const transcript_path of [null, undefined, "", join(sb.home, "missing.jsonl")]) {
      await handleCodexStop(
        { session_id: SESSION, transcript_path, cwd: sb.repo },
        sb.deps(srv.url),
      );
    }
    await handleCodexStop(null, sb.deps(srv.url));
    expect(srv.requests).toHaveLength(0);
  });

  it("削った結果が空なら送らない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(rolloutLines().slice(0, 3)));
    await handleCodexStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );
    expect(srv.requests).toHaveLength(0);
  });
});

describe("handleCodexStop: fail-open", () => {
  it("サーバが 500 でも例外にならず、runFailOpen で exit 0", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ status: 500 }));
    const sb = sandbox;
    const path = sb.writeTranscript(jsonl());
    const code = await exitCodeOf(() =>
      handleCodexStop(
        { session_id: SESSION, transcript_path: path, cwd: sb.repo },
        sb.deps(server?.url ?? ""),
      ),
    );
    expect(code).toBe(0);
  });
});

describe("handleCodexSessionEnd", () => {
  it("最後の会話を送り直してから、要約の合図を送る(この順)", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl());
    await handleCodexSessionEnd(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo, reason: "other" },
      sb.deps(srv.url),
    );
    expect(srv.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PUT /v1/transcripts/${SESSION}`,
      `POST /v1/sessions/${SESSION}/end`,
    ]);
    expect(bodyOf(srv).tool).toBe("codex");
    expect(srv.requests[1]?.body ?? "").toBe("");
  });

  it("transcript_path が null でも合図は送る", async () => {
    const { sb, srv } = await setup();
    await handleCodexSessionEnd(
      { session_id: SESSION, transcript_path: null, cwd: sb.repo },
      sb.deps(srv.url),
    );
    expect(srv.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST /v1/sessions/${SESSION}/end`,
    ]);
  });

  it("送り直しが失敗(500)しても合図は送る", async () => {
    sandbox = makeSandbox();
    server = await startServer((req) => (req.method === "PUT" ? { status: 500 } : {}));
    const sb = sandbox;
    const path = sb.writeTranscript(jsonl());
    await handleCodexSessionEnd(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(server.url),
    );
    expect(server.requests.map((r) => r.method)).toEqual(["PUT", "POST"]);
  });

  it("送り直しで接続できなくても例外にせず、合図を試みる", async () => {
    sandbox = makeSandbox();
    const sb = sandbox;
    const path = sb.writeTranscript(jsonl());
    const code = await exitCodeOf(() =>
      handleCodexSessionEnd(
        { session_id: SESSION, transcript_path: path, cwd: sb.repo },
        { ...sb.deps("http://127.0.0.1:1"), timeoutMs: 2_000 },
      ),
    );
    expect(code).toBe(0);
    const log = readFileSync(join(sb.home, ".ikisatsu", "logs", "http-errors.log"), "utf-8");
    expect(log).toContain('"hook":"codex-session-end"');
  });

  it("トークンが無ければ何もしない", async () => {
    const { sb, srv } = await setup({ token: null });
    await handleCodexSessionEnd(
      { session_id: SESSION, transcript_path: null, cwd: sb.repo },
      sb.deps(srv.url),
    );
    expect(srv.requests).toHaveLength(0);
  });
});
