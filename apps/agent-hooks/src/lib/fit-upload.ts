// 送信前に、サーバの上限(件数・本文サイズ)に収める。古い entries から落とす。
// text の長さは filter 側で切っている(1 件 maxTextChars)

import { TRANSCRIPT_LIMITS, type TranscriptEntry } from "@ikisatsu/core";

/** projectId / tool / JSON の枠に見込む余白 */
const ENVELOPE_MARGIN_BYTES = 1024;

export function fitEntries(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const byCount = entries.slice(-TRANSCRIPT_LIMITS.maxEntries);
  const budget = TRANSCRIPT_LIMITS.maxBodyBytes - ENVELOPE_MARGIN_BYTES;

  // 新しい方から積んで、収まる範囲を残す(+1 は区切りのカンマ)
  let total = 0;
  let start = byCount.length;
  for (let i = byCount.length - 1; i >= 0; i--) {
    const entry = byCount[i];
    if (entry === undefined) continue;
    total += Buffer.byteLength(JSON.stringify(entry), "utf-8") + 1;
    if (total > budget) break;
    start = i;
  }
  return byCount.slice(start);
}
