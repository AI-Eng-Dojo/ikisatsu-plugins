// Stop(async: true): transcript を発言だけに削って PUT /v1/transcripts/:sessionId に送る。
// フックは fail-open(呼び出し側の runFailOpen が握る)。ここでは「送らない」条件を早めに return で表す

import { readFile } from "node:fs/promises";
import type { TranscriptUpload } from "@ikisatsu/core";
import { authedRequest } from "../lib/authed-request.ts";
import { fitEntries } from "../lib/fit-upload.ts";
import { type HookDeps, resolveHookContext } from "../lib/hook-context.ts";
import { withLastAssistantMessage } from "../lib/last-assistant-message.ts";
import { filterClaudeCodeTranscript } from "./filter-transcript.ts";

export { withLastAssistantMessage };

export const STOP_TIMEOUT_MS = 10_000;

export async function handleStop(
  input: Record<string, unknown> | null,
  deps: HookDeps,
): Promise<void> {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: true });
  if (ctx === null || input === null) return;

  const transcriptPath = input.transcript_path;
  if (typeof transcriptPath !== "string" || transcriptPath === "") return;

  // transcript が読めないときは何も送らない(last_assistant_message だけで PUT すると、
  // サーバの全文を 1 件で上書きしてしまう)
  let jsonl: string;
  try {
    jsonl = await readFile(transcriptPath, "utf-8");
  } catch {
    return;
  }

  const filtered = filterClaudeCodeTranscript(jsonl, { repoRoot: ctx.repoRoot });
  const entries = fitEntries(withLastAssistantMessage(filtered, input.last_assistant_message));
  if (entries.length === 0) return;

  const body: TranscriptUpload = { projectId: ctx.projectId, tool: "claude-code", entries };
  await authedRequest(ctx, deps, "claude-code-stop", {
    method: "PUT",
    url: `${ctx.apiUrl}/v1/transcripts/${ctx.sessionId}`,
    body,
    timeoutMs: deps.timeoutMs ?? STOP_TIMEOUT_MS,
  });
}
