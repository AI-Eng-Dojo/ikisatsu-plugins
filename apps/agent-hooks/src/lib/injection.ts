// SessionStart の注入文面の取得。Claude Code / Codex が共用する
// (出力の包み方 = JSON の形だけがツールごとに違う)

import { type Digest, formatInjection, type InjectionDomain } from "@ikisatsu/core";
import { authedRequest } from "./authed-request.ts";
import type { HookContext, HookDeps } from "./hook-context.ts";

export const SESSION_START_TIMEOUT_MS = 5_000;
/** サーバからの知らせ(今月の要約の上限など)に割く最大の文字数 */
const MAX_NOTICE_CHARS = 300;

function isDigest(v: unknown): v is Digest {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.headline === "string" &&
    typeof d.body === "string" &&
    typeof d.updatedAt === "string" &&
    typeof d.isMine === "boolean" &&
    (d.displayName === null || typeof d.displayName === "string")
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 長期の記憶(ルールと最近の決定)。形が違えば丸ごと捨てる(古いサーバは domain を返さない) */
function isInjectionDomain(v: unknown): v is InjectionDomain {
  if (!isRecord(v) || !Array.isArray(v.rules) || !Array.isArray(v.decisions)) return false;
  const rulesOk = v.rules.every(
    (r) => isRecord(r) && typeof r.name === "string" && typeof r.statement === "string",
  );
  const decisionsOk = v.decisions.every(
    (d) =>
      isRecord(d) &&
      typeof d.name === "string" &&
      typeof d.rationale === "string" &&
      typeof d.decidedAt === "string" &&
      (d.displayName === null || typeof d.displayName === "string"),
  );
  return rulesOk && decisionsOk;
}

/** GET /v1/digests → 注入用の文面(短期の記憶 + ルールと最近の決定)。失敗・不正な応答は空文字(呼び出し側は何も出力しない) */
export async function fetchInjectionText(
  ctx: HookContext,
  deps: HookDeps,
  maxChars: number,
  /** 診断ログに残すフック名 */
  hook: string,
): Promise<string> {
  const res = await authedRequest(ctx, deps, hook, {
    method: "GET",
    url: `${ctx.apiUrl}/v1/digests?projectId=${encodeURIComponent(ctx.projectId)}`,
    timeoutMs: deps.timeoutMs ?? SESSION_START_TIMEOUT_MS,
  });
  if (!res.ok) return "";
  const json = res.json as { digests?: unknown; domain?: unknown; notice?: unknown } | undefined;
  const digests = json?.digests;
  if (!Array.isArray(digests)) return "";
  const domain = isInjectionDomain(json?.domain) ? json.domain : null;
  // 知らせ(#127)は先頭に置く。古いサーバは notice を返さない
  const notice =
    typeof json?.notice === "string"
      ? [...json.notice.trim()].slice(0, MAX_NOTICE_CHARS).join("")
      : "";
  if (notice === "") return formatInjection(digests.filter(isDigest), domain, { maxChars });
  const rest = formatInjection(digests.filter(isDigest), domain, {
    maxChars: maxChars - notice.length - 2,
  });
  return rest === "" ? notice : `${notice}\n\n${rest}`;
}
