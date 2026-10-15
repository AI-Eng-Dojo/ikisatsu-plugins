// Stop の入力の last_assistant_message で、会話ログにまだ書かれていない最後の返答を補う。
// Claude Code / Codex の Stop が共用する

import { TRANSCRIPT_LIMITS, type TranscriptEntry } from "@ikisatsu/core";

/**
 * transcript は非同期に書かれるので、最後のアシスタントの発言が欠けていることがある。
 * 最後の user 以降のアシスタントの発言に同じ本文が無ければ、last_assistant_message を末尾に足す
 */
export function withLastAssistantMessage(
  entries: readonly TranscriptEntry[],
  lastAssistantMessage: unknown,
): TranscriptEntry[] {
  if (typeof lastAssistantMessage !== "string") return [...entries];
  const message = lastAssistantMessage.trim();
  if (message === "") return [...entries];

  let lastUser = -1;
  entries.forEach((e, i) => {
    if (e.kind === "user") lastUser = i;
  });
  const alreadyThere = entries
    .slice(lastUser + 1)
    .some((e) => e.kind === "assistant" && e.text.trim() === message);
  if (alreadyThere) return [...entries];

  return [
    ...entries,
    { kind: "assistant", text: message.slice(0, TRANSCRIPT_LIMITS.maxTextChars) },
  ];
}
