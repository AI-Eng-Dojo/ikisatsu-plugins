import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFailOpen } from "../lib/fail-open.ts";
import { makeSandbox, type Sandbox, startServer, type TestServer } from "../testing/sandbox.ts";
import { handleStop, withLastAssistantMessage } from "./stop.ts";

const SESSION = "sess-1234abcd";
const at = "2026-09-29T01:02:03.000Z";

const transcript = [
  { type: "user", timestamp: at, message: { content: "設定ファイルを直して" } },
  {
    type: "assistant",
    timestamp: at,
    message: {
      content: [
        { type: "thinking", thinking: "SECRET-THOUGHT" },
        { type: "text", text: "読みます" },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "REPO/.env" } },
        {
          type: "tool_use",
          id: "t2",
          name: "Bash",
          input: {
            command: "curl -H 'Authorization: Bearer iks_SECRET' x", // gitleaks:allow テスト用のダミー値
            description: "疎通確認",
          },
        },
      ],
    },
  },
  {
    type: "user",
    timestamp: at,
    message: {
      content: [{ type: "tool_result", tool_use_id: "t1", content: "API_KEY=sk-live-LEAK" }],
    },
    toolUseResult: { stdout: "LEAK-STDOUT" },
  },
  {
    type: "user",
    timestamp: at,
    message: { content: "<system-reminder>SECRET-REMINDER</system-reminder>" },
  },
  {
    type: "assistant",
    timestamp: at,
    message: { content: [{ type: "text", text: "直しました" }] },
  },
];

function jsonl(repo: string): string {
  return transcript.map((l) => JSON.stringify(l).replaceAll("REPO", repo)).join("\n");
}

let sandbox: Sandbox | undefined;
let server: TestServer | undefined;

afterEach(async () => {
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

describe("handleStop: 送る内容", () => {
  it("発言とツール名だけを PUT /v1/transcripts/:sessionId に送る(Bearer 付き)", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(sb.repo));

    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );

    expect(srv.requests).toHaveLength(1);
    const req = srv.requests[0];
    expect(req?.method).toBe("PUT");
    expect(req?.path).toBe(`/v1/transcripts/${SESSION}`);
    expect(req?.headers.authorization).toBe("Bearer iks_test-token");
    const body = JSON.parse(req?.body ?? "");
    expect(Object.keys(body).sort()).toEqual(["entries", "projectId", "tool"]);
    expect(body.projectId).toBe("test-project");
    expect(body.tool).toBe("claude-code");
    expect(body.entries).toEqual([
      { kind: "user", text: "設定ファイルを直して", at },
      { kind: "assistant", text: "読みます", at },
      { kind: "tool", name: "Read", target: ".env", at },
      { kind: "tool", name: "Bash", target: "疎通確認", at },
      { kind: "assistant", text: "直しました", at },
    ]);
  });

  it("送信ボディに、実行結果・.env の中身・コマンド文字列・system-reminder・思考が含まれない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(sb.repo));

    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );

    const raw = srv.requests[0]?.body ?? "";
    for (const secret of [
      "sk-live-LEAK",
      "LEAK-STDOUT",
      "iks_SECRET",
      "curl",
      "SECRET-REMINDER",
      "SECRET-THOUGHT",
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("送信ボディの entries は core の型のキーしか持たない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(sb.repo));

    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );

    const body = JSON.parse(srv.requests[0]?.body ?? "");
    const allowed = new Set(["kind", "text", "name", "target", "at"]);
    for (const e of body.entries) {
      for (const k of Object.keys(e)) expect(allowed.has(k)).toBe(true);
    }
  });

  it("transcript に最後の発言が無いとき、last_assistant_message で補う", async () => {
    const { sb, srv } = await setup();
    const lines = transcript.slice(0, 4).map((l) => JSON.stringify(l).replaceAll("REPO", sb.repo));
    const path = sb.writeTranscript(lines.join("\n"));

    await handleStop(
      {
        session_id: SESSION,
        transcript_path: path,
        cwd: sb.repo,
        last_assistant_message: "最後の返答です",
      },
      sb.deps(srv.url),
    );

    const body = JSON.parse(srv.requests[0]?.body ?? "");
    expect(body.entries.at(-1)).toEqual({ kind: "assistant", text: "最後の返答です" });
  });

  it("transcript に既にある最後の発言は重複させない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(sb.repo));

    await handleStop(
      {
        session_id: SESSION,
        transcript_path: path,
        cwd: sb.repo,
        last_assistant_message: "直しました",
      },
      sb.deps(srv.url),
    );

    const body = JSON.parse(srv.requests[0]?.body ?? "");
    expect(body.entries.filter((e: { text?: string }) => e.text === "直しました")).toHaveLength(1);
  });

  it("cwd がサブディレクトリでも .ikisatsu.json を親から探し、target はそのルートからの相対になる", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(sb.repo));

    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: join(sb.repo, "sub") },
      sb.deps(srv.url),
    );

    const body = JSON.parse(srv.requests[0]?.body ?? "");
    expect(body.entries[2]).toMatchObject({ target: ".env" });
  });

  it("IKISATSU_TOKEN が ~/.ikisatsu/token より優先される", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(sb.repo));

    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url, { IKISATSU_TOKEN: "iks_from-env" }),
    );

    expect(srv.requests[0]?.headers.authorization).toBe("Bearer iks_from-env");
  });
});

describe("handleStop: 何も送らない条件", () => {
  it(".ikisatsu.json が無いリポジトリでは何も送らない", async () => {
    const { sb, srv } = await setup({ project: null });
    const path = sb.writeTranscript(jsonl(sb.repo));
    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );
    expect(srv.requests).toHaveLength(0);
  });

  it("トークンが無ければ何も送らない", async () => {
    const { sb, srv } = await setup({ token: null });
    const path = sb.writeTranscript(jsonl(sb.repo));
    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );
    expect(srv.requests).toHaveLength(0);
  });

  it("session_id が不正 / 欠落なら何も送らない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(sb.repo));
    for (const session_id of ["short", "../../etc/passwd", 123, undefined]) {
      await handleStop({ session_id, transcript_path: path, cwd: sb.repo }, sb.deps(srv.url));
    }
    expect(srv.requests).toHaveLength(0);
  });

  it("入力が null / transcript_path が無い / 読めないなら何も送らない(last_assistant_message だけで上書きしない)", async () => {
    const { sb, srv } = await setup();
    await handleStop(null, sb.deps(srv.url));
    await handleStop(
      { session_id: SESSION, cwd: sb.repo, last_assistant_message: "x" },
      sb.deps(srv.url),
    );
    await handleStop(
      {
        session_id: SESSION,
        cwd: sb.repo,
        transcript_path: join(sb.repo, "no-such.jsonl"),
        last_assistant_message: "x",
      },
      sb.deps(srv.url),
    );
    expect(srv.requests).toHaveLength(0);
  });

  it("削った結果が空なら何も送らない", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript("");
    await handleStop(
      { session_id: SESSION, transcript_path: path, cwd: sb.repo },
      sb.deps(srv.url),
    );
    expect(srv.requests).toHaveLength(0);
  });

  it("cwd が入力に無いときは deps.cwd を使う", async () => {
    const { sb, srv } = await setup();
    const path = sb.writeTranscript(jsonl(sb.repo));
    await handleStop({ session_id: SESSION, transcript_path: path }, sb.deps(srv.url));
    expect(srv.requests).toHaveLength(1);
  });
});

describe("handleStop: fail-open", () => {
  it("サーバが 500 でも例外にならない", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({
      status: 500,
      json: { error: { code: "x", message: "y" } },
    }));
    const path = sandbox.writeTranscript(jsonl(sandbox.repo));
    await expect(
      handleStop(
        { session_id: SESSION, transcript_path: path, cwd: sandbox.repo },
        sandbox.deps(server.url),
      ),
    ).resolves.toBeUndefined();
  });

  it("サーバがタイムアウトしても、runFailOpen 経由で exit 0 になる", async () => {
    sandbox = makeSandbox();
    server = await startServer(() => ({ delayMs: 500 }));
    const sb = sandbox;
    const path = sb.writeTranscript(jsonl(sb.repo));
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
  });

  it("接続できなくても(サーバ停止)runFailOpen 経由で exit 0 になる", async () => {
    sandbox = makeSandbox();
    const sb = sandbox;
    const path = sb.writeTranscript(jsonl(sb.repo));
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
  });
});

describe("withLastAssistantMessage", () => {
  it("文字列でない / 空白だけなら何もしない", () => {
    const entries = [{ kind: "user" as const, text: "q" }];
    expect(withLastAssistantMessage(entries, undefined)).toEqual(entries);
    expect(withLastAssistantMessage(entries, "  \n")).toEqual(entries);
  });

  it("最後の user より前に同じ本文があっても、それは重複とみなさず補う", () => {
    const out = withLastAssistantMessage(
      [
        { kind: "assistant", text: "了解" },
        { kind: "user", text: "次" },
      ],
      "了解",
    );
    expect(out).toHaveLength(3);
  });

  it("20000 字を超える本文は切る", () => {
    const out = withLastAssistantMessage([], "あ".repeat(30000));
    expect(out[0]?.kind === "assistant" && out[0].text.length).toBe(20000);
  });
});
