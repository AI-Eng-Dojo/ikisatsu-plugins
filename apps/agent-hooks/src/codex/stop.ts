// Codex の Stop: rollout を発言・返答・ツール名だけに削って PUT /v1/transcripts/:sessionId に送る(#82)。
// Codex は async のフックも同期で動かすので、1 ターンごとに送信を待つ。タイムアウトは短めにする。
// stdout には何も書かない(Codex の Stop は stdout の JSON を判定に使う)

import { readFile } from "node:fs/promises";
import type { TranscriptUpload } from "@ikisatsu/core";
import { authedRequest } from "../lib/authed-request.ts";
import { appendTranscriptWarning } from "../lib/diag-log.ts";
import { fitEntries } from "../lib/fit-upload.ts";
import { type HookContext, type HookDeps, resolveHookContext } from "../lib/hook-context.ts";
import { withLastAssistantMessage } from "../lib/last-assistant-message.ts";
import { filterCodexTranscript } from "./filter-transcript.ts";

export const CODEX_STOP_TIMEOUT_MS = 5_000;

/**
 * rollout を削って送る。送らなかった(読めない・空)ときは false。SessionEnd も最後の送り直しに使う。
 * ユーザーの発言が 0 件なら、読めた分は送ったうえで診断ログに残す(グリル C6。形式の変化に気づくため)
 */
export async function uploadCodexTranscript(
  input: Record<string, unknown>,
  ctx: HookContext,
  deps: HookDeps,
  hook: string,
): Promise<boolean> {
  const transcriptPath = input.transcript_path;
  if (typeof transcriptPath !== "string" || transcriptPath === "") return false;
  let jsonl: string;
  try {
    jsonl = await readFile(transcriptPath, "utf-8");
  } catch {
    return false;
  }

  const entries = fitEntries(
    withLastAssistantMessage(filterCodexTranscript(jsonl), input.last_assistant_message),
  );
  if (entries.length === 0) return false;
  if (!entries.some((e) => e.kind === "user")) {
    await appendTranscriptWarning(deps.home, {
      at: new Date().toISOString(),
      hook,
      warning: "no_user_messages",
      entries: entries.length,
    });
  }

  const body: TranscriptUpload = { projectId: ctx.projectId, tool: "codex", entries };
  await authedRequest(ctx, deps, hook, {
    method: "PUT",
    url: `${ctx.apiUrl}/v1/transcripts/${ctx.sessionId}`,
    body,
    timeoutMs: deps.timeoutMs ?? CODEX_STOP_TIMEOUT_MS,
  });
  return true;
}

export async function handleCodexStop(
  input: Record<string, unknown> | null,
  deps: HookDeps,
): Promise<void> {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: true });
  if (ctx === null || input === null) return;
  await uploadCodexTranscript(input, ctx, deps, "codex-stop");
}
