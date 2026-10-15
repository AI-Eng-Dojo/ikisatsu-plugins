import { describe, expect, it } from "vitest";
import { filterClaudeCodeTranscript } from "./filter-transcript.ts";

const repoRoot = "/work/repo";
const at = "2026-09-29T01:02:03.000Z";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}
function user(content: unknown, extra: Record<string, unknown> = {}): string {
  return line({ type: "user", timestamp: at, message: { role: "user", content }, ...extra });
}
function assistant(content: unknown[], extra: Record<string, unknown> = {}): string {
  return line({
    type: "assistant",
    timestamp: at,
    message: { role: "assistant", content },
    ...extra,
  });
}
function run(...lines: string[]) {
  return filterClaudeCodeTranscript(lines.join("\n"), { repoRoot });
}

describe("filterClaudeCodeTranscript: 残すもの", () => {
  it("user の文字列 content を発言として残し、時刻を at に入れる", () => {
    expect(run(user("ログイン画面を直して"))).toEqual([
      { kind: "user", text: "ログイン画面を直して", at },
    ]);
  });

  it("user の配列 content は text ブロックだけを残す", () => {
    const out = run(
      user([
        { type: "text", text: "前半" },
        { type: "image", source: { data: "AAAA" } },
        { type: "text", text: "後半" },
      ]),
    );
    expect(out.map((e) => (e.kind === "user" ? e.text : ""))).toEqual(["前半", "後半"]);
  });

  it("assistant の text ブロックを残す", () => {
    expect(run(assistant([{ type: "text", text: "直しました" }]))).toEqual([
      { kind: "assistant", text: "直しました", at },
    ]);
  });

  it("時刻が無い行は at を付けない", () => {
    const out = run(line({ type: "user", message: { content: "こんにちは" } }));
    expect(out).toEqual([{ kind: "user", text: "こんにちは" }]);
    expect(Object.keys(out[0] ?? {})).not.toContain("at");
  });

  it("会話の順序を保つ", () => {
    const out = run(
      user("q1"),
      assistant([{ type: "text", text: "a1" }]),
      user("q2"),
      assistant([{ type: "text", text: "a2" }]),
    );
    expect(out.map((e) => (e.kind === "tool" ? e.name : e.text))).toEqual(["q1", "a1", "q2", "a2"]);
  });
});

describe("filterClaudeCodeTranscript: 落とすもの(漏えい防止)", () => {
  const SECRET_ENV = "API_KEY=sk-live-DO-NOT-LEAK";
  const SECRET_OUTPUT = "PASSWORD_HASH=$2b$12$verysecretoutput";

  it("tool_result(ツールの実行結果・.env の中身)は出力のどこにも現れない", () => {
    const out = run(
      user("設定を見せて"),
      assistant([
        { type: "text", text: "読みます" },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/work/repo/.env" } },
      ]),
      user([{ type: "tool_result", tool_use_id: "t1", content: SECRET_ENV }]),
      user([
        {
          type: "tool_result",
          tool_use_id: "t2",
          content: [{ type: "text", text: SECRET_OUTPUT }],
        },
      ]),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain("sk-live-DO-NOT-LEAK");
    expect(json).not.toContain("verysecretoutput");
    expect(out).toEqual([
      { kind: "user", text: "設定を見せて", at },
      { kind: "assistant", text: "読みます", at },
      { kind: "tool", name: "Read", target: ".env", at },
    ]);
  });

  it("toolUseResult(行の付随フィールド)も出力に現れない", () => {
    const out = run(
      user([{ type: "tool_result", tool_use_id: "t1", content: "x" }], {
        toolUseResult: { stdout: SECRET_OUTPUT },
      }),
      user("次へ", { toolUseResult: { stdout: SECRET_OUTPUT } }),
    );
    expect(JSON.stringify(out)).not.toContain("verysecretoutput");
  });

  it("Bash のコマンド文字列は出力に現れず、description だけが target になる", () => {
    const out = run(
      assistant([
        {
          type: "tool_use",
          id: "t1",
          name: "Bash",
          input: {
            command: "curl -H 'Authorization: Bearer iks_SECRETTOKEN' https://example.com", // gitleaks:allow テスト用のダミー値
            description: "API を叩いて疎通確認する",
          },
        },
      ]),
    );
    expect(out).toEqual([{ kind: "tool", name: "Bash", target: "API を叩いて疎通確認する", at }]);
    expect(JSON.stringify(out)).not.toContain("iks_SECRETTOKEN");
    expect(JSON.stringify(out)).not.toContain("curl");
  });

  it("Bash に description が無ければ target を付けない(コマンドで代用しない)", () => {
    const out = run(
      assistant([
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "echo secret-command" } },
      ]),
    );
    expect(out).toEqual([{ kind: "tool", name: "Bash", at }]);
  });

  it("Edit / Write の内容(old_string / new_string / content)は出力に現れない", () => {
    const out = run(
      assistant([
        {
          type: "tool_use",
          id: "t1",
          name: "Edit",
          input: {
            file_path: "/work/repo/src/a.ts",
            old_string: "const key = 'OLD-SECRET'",
            new_string: "const key = 'NEW-SECRET'",
          },
        },
        {
          type: "tool_use",
          id: "t2",
          name: "Write",
          input: { file_path: "/work/repo/src/b.ts", content: "WRITE-BODY-SECRET" },
        },
      ]),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain("SECRET");
    expect(out).toEqual([
      { kind: "tool", name: "Edit", target: "src/a.ts", at },
      { kind: "tool", name: "Write", target: "src/b.ts", at },
    ]);
  });

  it("system-reminder を user の本文から取り除く(全体が reminder なら行ごと捨てる)", () => {
    const out = run(
      user("<system-reminder>\nCLAUDE.md の中身 SECRET-RULES\n</system-reminder>\n本題です"),
      user("<system-reminder>only reminder SECRET-RULES</system-reminder>"),
      user([
        { type: "text", text: "<system-reminder>SECRET-RULES</system-reminder>" },
        { type: "text", text: "実際の質問" },
      ]),
    );
    expect(JSON.stringify(out)).not.toContain("SECRET-RULES");
    expect(out.map((e) => (e.kind === "user" ? e.text : ""))).toEqual(["本題です", "実際の質問"]);
  });

  it("閉じていない system-reminder は、開始タグから末尾までを落とす", () => {
    const out = run(user("質問\n<system-reminder>閉じ忘れ SECRET-RULES"));
    expect(JSON.stringify(out)).not.toContain("SECRET-RULES");
    expect(out).toEqual([{ kind: "user", text: "質問", at }]);
  });

  it("local-command-stdout / bash-stdout / bash-stderr / bash-input を取り除く", () => {
    const out = run(
      user("<local-command-stdout>cost: $1 SECRET-OUT</local-command-stdout>"),
      user(
        "<bash-input>cat .env SECRET-CMD</bash-input><bash-stdout>SECRET-OUT</bash-stdout><bash-stderr>SECRET-ERR</bash-stderr>",
      ),
      user("<local-command-caveat>Caveat: SECRET-CAVEAT</local-command-caveat>\n続きをやって"),
    );
    const json = JSON.stringify(out);
    for (const s of ["SECRET-OUT", "SECRET-CMD", "SECRET-ERR", "SECRET-CAVEAT"]) {
      expect(json).not.toContain(s);
    }
    expect(out).toEqual([{ kind: "user", text: "続きをやって", at }]);
  });

  it("thinking ブロックを捨てる(text は残す)", () => {
    const out = run(
      assistant([
        { type: "thinking", thinking: "SECRET-THOUGHT", signature: "sig" },
        { type: "redacted_thinking", data: "SECRET-THOUGHT" },
        { type: "text", text: "結論です" },
      ]),
    );
    expect(JSON.stringify(out)).not.toContain("SECRET-THOUGHT");
    expect(out).toEqual([{ kind: "assistant", text: "結論です", at }]);
  });

  it("isSidechain: true(サブエージェント)の行を捨てる", () => {
    const out = run(
      user("サブの発言 SECRET-SUB", { isSidechain: true }),
      assistant([{ type: "text", text: "サブの返答 SECRET-SUB" }], { isSidechain: true }),
      user("本流"),
    );
    expect(out).toEqual([{ kind: "user", text: "本流", at }]);
  });

  it("isMeta: true の行を捨てる", () => {
    const out = run(user("スキル本文 SECRET-META", { isMeta: true }), user("本流"));
    expect(out).toEqual([{ kind: "user", text: "本流", at }]);
  });

  it("user / assistant 以外の行(attachment / system / snapshot 等)を捨てる", () => {
    const out = run(
      line({ type: "attachment", attachment: { content: "SECRET-ATT" } }),
      line({ type: "system", content: "SECRET-SYS" }),
      line({ type: "file-history-snapshot", snapshot: { x: "SECRET-SNAP" } }),
      user("本流"),
    );
    expect(out).toEqual([{ kind: "user", text: "本流", at }]);
  });
});

describe("filterClaudeCodeTranscript: tool_use の target", () => {
  it("Edit / Write / Read / NotebookEdit の file_path をリポジトリ相対にする", () => {
    const out = run(
      assistant([
        { type: "tool_use", id: "1", name: "Edit", input: { file_path: "/work/repo/a/b.ts" } },
        { type: "tool_use", id: "2", name: "Write", input: { file_path: "/work/repo/c.md" } },
        { type: "tool_use", id: "3", name: "Read", input: { file_path: "/work/repo/d/e.json" } },
        {
          type: "tool_use",
          id: "4",
          name: "NotebookEdit",
          input: { notebook_path: "/work/repo/n.ipynb", file_path: "/work/repo/n.ipynb" },
        },
      ]),
    );
    expect(out.map((e) => (e.kind === "tool" ? e.target : undefined))).toEqual([
      "a/b.ts",
      "c.md",
      "d/e.json",
      "n.ipynb",
    ]);
  });

  it("リポジトリ外のパスは target を付けない(ホームのパスなどを送らない)", () => {
    const out = run(
      assistant([
        {
          type: "tool_use",
          id: "1",
          name: "Read",
          input: { file_path: "/Users/someone/.ssh/id_rsa" },
        },
        { type: "tool_use", id: "2", name: "Read", input: { file_path: "/work/repo-other/x.ts" } },
        {
          type: "tool_use",
          id: "3",
          name: "Read",
          input: { file_path: "/work/repo/../secret.txt" },
        },
      ]),
    );
    expect(out).toEqual([
      { kind: "tool", name: "Read", at },
      { kind: "tool", name: "Read", at },
      { kind: "tool", name: "Read", at },
    ]);
  });

  it("相対パスの file_path はそのまま使う(正規化して外に出るものは付けない)", () => {
    const out = run(
      assistant([
        { type: "tool_use", id: "1", name: "Read", input: { file_path: "src/x.ts" } },
        { type: "tool_use", id: "2", name: "Read", input: { file_path: "../out.ts" } },
      ]),
    );
    expect(out.map((e) => (e.kind === "tool" ? e.target : "x"))).toEqual(["src/x.ts", undefined]);
  });

  it("Windows 形式のパスもリポジトリ相対にできる", () => {
    const out = filterClaudeCodeTranscript(
      assistant([
        {
          type: "tool_use",
          id: "1",
          name: "Edit",
          input: { file_path: "C:\\work\\repo\\src\\a.ts" },
        },
      ]),
      { repoRoot: "C:\\work\\repo" },
    );
    expect(out).toEqual([{ kind: "tool", name: "Edit", target: "src/a.ts", at }]);
  });

  it("file_path が文字列でなければ target を付けない", () => {
    const out = run(
      assistant([{ type: "tool_use", id: "1", name: "Edit", input: { file_path: 123 } }]),
      assistant([{ type: "tool_use", id: "2", name: "Edit" }]),
    );
    expect(out.every((e) => e.kind === "tool" && e.target === undefined)).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("それ以外のツール(Grep / WebFetch / MCP など)は name だけで、input を持ち込まない", () => {
    const out = run(
      assistant([
        { type: "tool_use", id: "1", name: "Grep", input: { pattern: "SECRET-PATTERN" } },
        {
          type: "tool_use",
          id: "2",
          name: "WebFetch",
          input: { url: "https://x/?token=SECRET-URL" },
        },
        { type: "tool_use", id: "3", name: "mcp__x__y", input: { q: "SECRET-Q" } },
      ]),
    );
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(out.map((e) => (e.kind === "tool" ? e.name : ""))).toEqual([
      "Grep",
      "WebFetch",
      "mcp__x__y",
    ]);
  });

  it("name が文字列でない tool_use は捨てる", () => {
    expect(run(assistant([{ type: "tool_use", id: "1", input: {} }]))).toEqual([]);
  });

  it("target が長すぎるときは切り詰める", () => {
    const out = run(
      assistant([
        { type: "tool_use", id: "1", name: "Bash", input: { description: "あ".repeat(5000) } },
      ]),
    );
    const e = out[0];
    expect(e?.kind === "tool" && (e.target?.length ?? 0) <= 500).toBe(true);
  });
});

describe("filterClaudeCodeTranscript: 頑健性", () => {
  it("解析できない行・空行・オブジェクトでない行を黙って飛ばす", () => {
    const out = run("{not json", "", "   ", "123", "null", '"str"', "[1,2]", user("生きている行"));
    expect(out).toEqual([{ kind: "user", text: "生きている行", at }]);
  });

  it("message が無い / content が想定外の型でも例外にしない", () => {
    const out = run(
      line({ type: "user" }),
      line({ type: "user", message: "x" }),
      line({ type: "user", message: { content: 42 } }),
      line({ type: "assistant", message: { content: "文字列の assistant" } }),
      line({
        type: "assistant",
        message: { content: [null, 1, "s", { type: "text" }, { type: "text", text: 5 }] },
      }),
      line({ type: "user", message: { content: [null, { type: "text", text: "  " }] } }),
    );
    expect(out).toEqual([]);
  });

  it("空文字・空白だけの本文は捨てる", () => {
    expect(run(user("   \n "), assistant([{ type: "text", text: "" }]))).toEqual([]);
  });

  it("空入力は空配列", () => {
    expect(filterClaudeCodeTranscript("", { repoRoot })).toEqual([]);
  });

  it("CRLF 区切りでも読める", () => {
    const out = filterClaudeCodeTranscript(`${user("a")}\r\n${user("b")}\r\n`, { repoRoot });
    expect(out).toHaveLength(2);
  });

  it("text が 20000 字を超えたら切り詰める", () => {
    const out = run(user("あ".repeat(30000)));
    const e = out[0];
    expect(e?.kind === "user" && e.text.length === 20000).toBe(true);
  });

  it("timestamp が文字列でなければ at を付けない", () => {
    const out = run(line({ type: "user", timestamp: 123, message: { content: "x" } }));
    expect(out).toEqual([{ kind: "user", text: "x" }]);
  });

  it("出力の要素は core の TranscriptEntry のキーだけを持つ", () => {
    const out = run(
      user("q"),
      assistant([
        { type: "text", text: "a" },
        {
          type: "tool_use",
          id: "1",
          name: "Edit",
          input: { file_path: "/work/repo/x.ts", old_string: "z" },
        },
      ]),
    );
    const allowed = new Set(["kind", "text", "name", "target", "at"]);
    for (const e of out) {
      for (const k of Object.keys(e)) expect(allowed.has(k)).toBe(true);
    }
  });
});
