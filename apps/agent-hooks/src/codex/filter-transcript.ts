// Codex の会話ログ(rollout の JSONL)を、発言・返答・ツール名だけの TranscriptEntry[] に削る(#81)。
// Codex 側の「実行結果・system prompt・コマンド文字列を送らない」ことの唯一の砦。
// rollout は公式に安定した仕様ではないので、許可リスト式: 知っている形の行の、明示したフィールドだけを読む。
//
// - 土台は生の形(response_item)(グリル C5)
// - role user の発言には Codex が差し込んだ文(AGENTS.md・<environment_context> など)が混ざる。
//   画面に出る形(event_msg の UserMessage)にも同じ文があるものだけを残す(C11)。差し込みは画面に出ない
// - ツールは名前だけ(C12)。入力(コマンド文字列・引数)と出力は読まない
// - 読めた分だけ返す(C6)。UserMessage が無い形式では発言が 0 件になる(呼び出し側が診断ログに残す)

import { TRANSCRIPT_LIMITS, type TranscriptEntry } from "@ikisatsu/core";

const MAX_NAME_CHARS = 200;
const MAX_AT_CHARS = 64;
const TOOL_CALL_TYPES = new Set(["custom_tool_call", "function_call"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function parseLine(raw: string): Record<string, unknown> | null {
  if (raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** content の配列から、type が一致する要素の text だけを取り出す */
function texts(content: unknown, type: string): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const item of content) {
    if (isRecord(item) && item.type === type && typeof item.text === "string") out.push(item.text);
  }
  return out;
}

/** 画面に出たユーザーの発言(event_msg の item_completed / UserMessage)。同じ文は回数を数える */
function shownUserTexts(rows: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "event_msg" || !isRecord(row.payload)) continue;
    if (row.payload.type !== "item_completed" || !isRecord(row.payload.item)) continue;
    if (row.payload.item.type !== "UserMessage") continue;
    for (const t of texts(row.payload.item.content, "text")) {
      const key = t.trim();
      if (key !== "") counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export function filterCodexTranscript(jsonlText: string): TranscriptEntry[] {
  const rows = jsonlText
    .split("\n")
    .map(parseLine)
    .filter((r): r is Record<string, unknown> => r !== null);
  const shown = shownUserTexts(rows);
  const entries: TranscriptEntry[] = [];

  for (const row of rows) {
    if (row.type !== "response_item" || !isRecord(row.payload)) continue;
    const p = row.payload;
    const at =
      typeof row.timestamp === "string" && row.timestamp.length <= MAX_AT_CHARS
        ? { at: row.timestamp }
        : {};

    if (p.type === "message" && p.role === "user") {
      for (const t of texts(p.content, "input_text")) {
        const text = t.trim();
        const left = shown.get(text) ?? 0;
        if (text === "" || left === 0) continue;
        shown.set(text, left - 1);
        entries.push({ kind: "user", text: clip(text, TRANSCRIPT_LIMITS.maxTextChars), ...at });
      }
    } else if (p.type === "message" && p.role === "assistant") {
      for (const t of texts(p.content, "output_text")) {
        const text = t.trim();
        if (text === "") continue;
        entries.push({
          kind: "assistant",
          text: clip(text, TRANSCRIPT_LIMITS.maxTextChars),
          ...at,
        });
      }
    } else if (typeof p.type === "string" && TOOL_CALL_TYPES.has(p.type)) {
      if (typeof p.name === "string" && p.name !== "") {
        entries.push({ kind: "tool", name: clip(p.name, MAX_NAME_CHARS), ...at });
      }
    }
    // developer / reasoning / *_output / その他の type は読まない(捨てる)
  }

  return entries;
}
