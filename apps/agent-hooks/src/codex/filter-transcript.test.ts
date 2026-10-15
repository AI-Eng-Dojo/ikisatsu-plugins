// Codex の会話ログ(rollout)を発言・返答・ツール名だけに削る(#81、グリル C5 / C6 / C11 / C12 / C13)。
// サンプルは本物の rollout の構造(キーと種類)に合わせ、本文はダミー

import { describe, expect, it } from "vitest";
import { filterCodexTranscript } from "./filter-transcript.ts";

const at = "2026-10-06T10:43:48.000Z";

function line(obj: unknown): string {
  return JSON.stringify(obj);
}
function rawUser(...texts: string[]): string {
  return line({
    timestamp: at,
    ordinal: 1,
    type: "response_item",
    payload: {
      type: "message",
      id: "m1",
      role: "user",
      content: texts.map((text) => ({ type: "input_text", text })),
    },
  });
}
function shownUser(...texts: string[]): string {
  return line({
    timestamp: at,
    ordinal: 2,
    type: "event_msg",
    payload: {
      type: "item_completed",
      thread_id: "t",
      turn_id: "u",
      item: {
        type: "UserMessage",
        id: "i1",
        client_id: "c1",
        content: texts.map((text) => ({ type: "text", text, text_elements: [] })),
      },
    },
  });
}
function said(...texts: string[]): string[] {
  return [rawUser(...texts), shownUser(...texts)];
}
function rawAssistant(text: string, extra: Record<string, unknown> = {}): string {
  return line({
    timestamp: at,
    type: "response_item",
    payload: {
      type: "message",
      id: "a1",
      role: "assistant",
      content: [{ type: "output_text", text }],
      phase: "final_answer",
      ...extra,
    },
  });
}
function developer(text: string): string {
  return line({
    timestamp: at,
    type: "response_item",
    payload: {
      type: "message",
      id: "d1",
      role: "developer",
      content: [{ type: "input_text", text }],
    },
  });
}
function exec(input: string): string {
  return line({
    timestamp: at,
    type: "response_item",
    payload: { type: "custom_tool_call", call_id: "x1", name: "exec", input, status: "completed" },
  });
}
function execOutput(output: string): string {
  return line({
    timestamp: at,
    type: "response_item",
    payload: { type: "custom_tool_call_output", call_id: "x1", output },
  });
}
function fnCall(name: string, args: string): string {
  return line({
    timestamp: at,
    type: "response_item",
    payload: { type: "function_call", call_id: "f1", name, arguments: args },
  });
}
function fnOutput(output: string): string {
  return line({
    timestamp: at,
    type: "response_item",
    payload: { type: "function_call_output", call_id: "f1", output },
  });
}
function sessionMeta(baseInstructions: string): string {
  return line({
    timestamp: at,
    type: "session_meta",
    payload: { id: "s", cwd: "/work/repo", base_instructions: { text: baseInstructions } },
  });
}
function reasoning(text: string): string {
  return line({
    timestamp: at,
    type: "response_item",
    payload: {
      type: "reasoning",
      summary: [{ type: "summary_text", text }],
      encrypted_content: "ENC",
    },
  });
}
function run(...lines: Array<string | string[]>) {
  return filterCodexTranscript(lines.flat().join("\n"));
}

const AGENTS_MD = "# AGENTS.md instructions for /work/repo\n\nSECRET-AGENTS-MD";
const ENV_CONTEXT =
  "<environment_context>\n  <cwd>/work/repo</cwd>\nSECRET-ENV\n</environment_context>";

describe("filterCodexTranscript: 残すもの", () => {
  it("画面にも出たユーザーの発言を残し、時刻を at に入れる", () => {
    expect(run(said("ログイン画面を直して"))).toEqual([
      { kind: "user", text: "ログイン画面を直して", at },
    ]);
  });

  it("assistant の output_text を残す(phase に関係なく)", () => {
    expect(
      run(rawAssistant("調べます", { phase: "commentary" }), rawAssistant("直しました")),
    ).toEqual([
      { kind: "assistant", text: "調べます", at },
      { kind: "assistant", text: "直しました", at },
    ]);
  });

  it("ツールは名前だけ残す(exec / function_call)", () => {
    expect(run(exec("cat .env"), fnCall("js", '{"code":"secret()"}'))).toEqual([
      { kind: "tool", name: "exec", at },
      { kind: "tool", name: "js", at },
    ]);
  });

  it("会話の順序は生の形(response_item)の順", () => {
    const out = run(said("q1"), rawAssistant("a1"), exec("ls"), said("q2"), rawAssistant("a2"));
    expect(out.map((e) => (e.kind === "tool" ? `tool:${e.name}` : `${e.kind}:${e.text}`))).toEqual([
      "user:q1",
      "assistant:a1",
      "tool:exec",
      "user:q2",
      "assistant:a2",
    ]);
  });

  it("画面の形が後から書かれても(順序が逆でも)発言を残す", () => {
    const out = run(shownUser("先に画面"), rawUser("先に画面"));
    expect(out).toEqual([{ kind: "user", text: "先に画面", at }]);
  });

  it("前後の空白の違いは同じ発言とみなす", () => {
    expect(run(rawUser("  直して\n"), shownUser("直して"))).toEqual([
      { kind: "user", text: "直して", at },
    ]);
  });

  it("20000 字を超える発言は切る", () => {
    const long = "あ".repeat(20001);
    const out = run(said(long));
    expect(out[0]?.kind === "user" && out[0].text.length).toBe(20000);
  });
});

describe("filterCodexTranscript: 落とすもの(negative)", () => {
  it("Codex が差し込んだ AGENTS.md と environment_context は、画面に出ないので落ちる", () => {
    const out = run(rawUser(AGENTS_MD, ENV_CONTEXT), said("本物の依頼"));
    expect(out).toEqual([{ kind: "user", text: "本物の依頼", at }]);
  });

  it("画面の形に無い発言は、どんな文でも落とす(知らない差し込みもすり抜けない)", () => {
    expect(
      run(rawUser("<new_injected_tag>SECRET</new_injected_tag>"), rawUser("普通の文")),
    ).toEqual([]);
  });

  it("同じ文の発言は、画面に出た回数までしか残さない", () => {
    const out = run(rawUser("続けて"), rawUser("続けて"), shownUser("続けて"));
    expect(out).toEqual([{ kind: "user", text: "続けて", at }]);
  });

  it("developer の文・system prompt・推論・ツールの入力と出力を落とす", () => {
    const out = run(
      sessionMeta("SECRET-BASE-INSTRUCTIONS"),
      developer("SECRET-DEVELOPER"),
      reasoning("SECRET-REASONING"),
      exec("curl -H 'Authorization: Bearer SECRET-TOKEN' https://x"), // gitleaks:allow テスト用のダミー値
      execOutput("SECRET-OUTPUT"),
      fnCall("js", '{"code":"SECRET-ARGS"}'),
      fnOutput("SECRET-FN-OUTPUT"),
      said("依頼"),
    );
    const body = JSON.stringify(out);
    for (const s of [
      "SECRET-BASE-INSTRUCTIONS",
      "SECRET-DEVELOPER",
      "SECRET-REASONING",
      "SECRET-TOKEN",
      "curl",
      "SECRET-OUTPUT",
      "SECRET-ARGS",
      "SECRET-FN-OUTPUT",
    ]) {
      expect(body, s).not.toContain(s);
    }
  });

  it("画面の形(event_msg)の返答・コマンド実行は、それ自体からは何も残さない", () => {
    const out = run(
      line({
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            command: "SECRET-CMD",
            aggregated_output: "SECRET-OUT",
          },
        },
      }),
      line({
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: { type: "AgentMessage", content: [{ text: "x" }] },
        },
      }),
      line({ type: "event_msg", payload: { type: "task_complete", last_agent_message: "y" } }),
    );
    expect(out).toEqual([]);
  });

  it("compacted / world_state / turn_context と知らない type の行は読まない", () => {
    const out = run(
      line({ type: "compacted", payload: { replacement_history: [{ text: "SECRET" }] } }),
      line({ type: "world_state", payload: { state: { agents_md: { text: "SECRET" } } } }),
      line({ type: "turn_context", payload: { cwd: "/work/repo" } }),
      line({ type: "response_item", payload: { type: "local_shell_call", action: "SECRET" } }),
      line({ type: "brand_new_type", payload: { text: "SECRET" } }),
    );
    expect(out).toEqual([]);
  });

  it("assistant の output_text 以外の content(画像など)は落とす", () => {
    const out = run(
      line({
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "image", url: "SECRET" },
            { type: "output_text", text: "見ました" },
          ],
        },
      }),
    );
    expect(out).toEqual([{ kind: "assistant", text: "見ました" }]);
  });

  it("壊れた JSON 行・空行・形の違う行は無視する", () => {
    const out = run(
      "{not json",
      "",
      "[]",
      line({ type: "response_item", payload: "x" }),
      line({ type: "response_item", payload: { type: "message", role: "user", content: "x" } }),
      line({ type: "response_item", payload: { type: "custom_tool_call", name: 1 } }),
      said("残る"),
    );
    expect(out).toEqual([{ kind: "user", text: "残る", at }]);
  });

  it("空白だけの発言・返答は残さない", () => {
    expect(run(said("   "), rawAssistant("  "))).toEqual([]);
  });
});

describe("filterCodexTranscript: 形式が変わったとき(C6)", () => {
  it("画面の形(UserMessage)が無い rollout では、発言は 0 件で、返答とツールは残る", () => {
    const out = run(rawUser("依頼"), rawAssistant("返答"), exec("ls"));
    expect(out).toEqual([
      { kind: "assistant", text: "返答", at },
      { kind: "tool", name: "exec", at },
    ]);
  });
});
