// Claude Code の transcript(JSONL)を、発言とツール名だけの TranscriptEntry[] に削る。
// ここが「実行結果・system prompt・コマンド文字列を送らない」ことの唯一の砦(設計書 §8)。
// 方針は許可リスト式: 明示的に取り出すフィールド(text / name / file_path / description)以外は読まない

import { posix } from "node:path";
import { TRANSCRIPT_LIMITS, type TranscriptEntry } from "@ikisatsu/core";

export interface FilterOptions {
  /** リポジトリのルート(.ikisatsu.json のあるディレクトリ)。file_path の相対化に使う */
  repoRoot: string;
}

const MAX_TARGET_CHARS = 500;
const MAX_NAME_CHARS = 200;
const MAX_AT_CHARS = 64;

/** user の本文から取り除くタグ。閉じ忘れは開始タグから末尾までを落とす(漏らすより消しすぎる) */
const STRIPPED_TAGS = [
  "system-reminder",
  "local-command-stdout",
  "local-command-stderr",
  "local-command-caveat",
  "bash-input",
  "bash-stdout",
  "bash-stderr",
] as const;
const STRIP_PATTERN = new RegExp(
  STRIPPED_TAGS.map((t) => `<${t}>[\\s\\S]*?(?:</${t}>|$)`).join("|"),
  "g",
);

const PATH_TOOLS = new Set(["Edit", "Write", "Read", "NotebookEdit"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function cleanUserText(raw: string): string {
  return raw.replace(STRIP_PATTERN, "").trim();
}

/** file_path をリポジトリ相対にする。リポジトリ外・解釈できないものは undefined(送らない) */
function toRepoRelative(filePath: string, repoRoot: string): string | undefined {
  const isAbsolute = (p: string) => p.startsWith("/") || /^[A-Za-z]:\//.test(p);
  const p = posix.normalize(filePath.replaceAll("\\", "/"));
  if (!isAbsolute(p)) {
    return p === "." || p === ".." || p.startsWith("../") ? undefined : p;
  }
  const root = posix.normalize(repoRoot.replaceAll("\\", "/")).replace(/\/+$/, "");
  if (!p.startsWith(`${root}/`)) return undefined;
  return p.slice(root.length + 1);
}

function toolTarget(
  name: string,
  input: Record<string, unknown>,
  repoRoot: string,
): string | undefined {
  if (PATH_TOOLS.has(name)) {
    const path = input.file_path ?? (name === "NotebookEdit" ? input.notebook_path : undefined);
    if (typeof path !== "string") return undefined;
    const rel = toRepoRelative(path, repoRoot);
    return rel === undefined ? undefined : clip(rel, MAX_TARGET_CHARS);
  }
  if (name === "Bash") {
    // コマンド文字列は送らない(トークンを含み得る)。人が読む説明の description だけ
    const desc = input.description;
    return typeof desc === "string" && desc.trim() !== ""
      ? clip(desc.trim(), MAX_TARGET_CHARS)
      : undefined;
  }
  return undefined;
}

function textBlocks(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts;
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

export function filterClaudeCodeTranscript(
  jsonlText: string,
  options: FilterOptions,
): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];

  for (const raw of jsonlText.split("\n")) {
    const row = parseLine(raw);
    if (!row) continue;
    if (row.isSidechain === true || row.isMeta === true) continue;
    if (row.type !== "user" && row.type !== "assistant") continue;

    const message = row.message;
    if (!isRecord(message)) continue;

    const at =
      typeof row.timestamp === "string" && row.timestamp.length <= MAX_AT_CHARS
        ? { at: row.timestamp }
        : {};

    if (row.type === "user") {
      // tool_result ブロックは text ブロックではないので、ここで自然に落ちる
      for (const t of textBlocks(message.content)) {
        const text = cleanUserText(t);
        if (text === "") continue;
        entries.push({ kind: "user", text: clip(text, TRANSCRIPT_LIMITS.maxTextChars), ...at });
      }
      continue;
    }

    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text === "") continue;
        entries.push({
          kind: "assistant",
          text: clip(text, TRANSCRIPT_LIMITS.maxTextChars),
          ...at,
        });
      } else if (block.type === "tool_use" && typeof block.name === "string" && block.name !== "") {
        const input = isRecord(block.input) ? block.input : {};
        const target = toolTarget(block.name, input, options.repoRoot);
        entries.push({
          kind: "tool",
          name: clip(block.name, MAX_NAME_CHARS),
          ...(target === undefined ? {} : { target }),
          ...at,
        });
      }
      // thinking / redacted_thinking などその他のブロックは読まない(捨てる)
    }
  }

  return entries;
}
