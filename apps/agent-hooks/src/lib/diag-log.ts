// 送信失敗の診断ログ: ~/.ikisatsu/logs/http-errors.log(JSON Lines)。
// 残すのは状態コード・Cloudflare 系のヘッダ・応答本文の先頭だけ。リクエスト本文・トークン・例外メッセージは残さない。
// 診断のための副作用なので、何があっても投げない(フックを止めない)

import { appendFile, chmod, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { tokenDir } from "./token.ts";

export const MAX_LOG_BYTES = 512 * 1024;

export function logDir(home: string): string {
  return join(tokenDir(home), "logs");
}

export function httpErrorLogPath(home: string): string {
  return join(logDir(home), "http-errors.log");
}

/** 会話ログを読んだときの警告(形式が変わって発言が読めない、など)。件数だけで本文は残さない */
export function transcriptLogPath(home: string): string {
  return join(logDir(home), "transcript.log");
}

/** 1 行(JSON Lines)で追記する。512KB を超えていたら先に .1 へ退避する(1 世代)。失敗は握りつぶす */
export async function appendHttpFailure(
  home: string,
  line: Record<string, unknown>,
): Promise<void> {
  await appendLine(home, httpErrorLogPath(home), line);
}

export async function appendTranscriptWarning(
  home: string,
  line: Record<string, unknown>,
): Promise<void> {
  await appendLine(home, transcriptLogPath(home), line);
}

async function appendLine(
  home: string,
  path: string,
  line: Record<string, unknown>,
): Promise<void> {
  try {
    const dir = logDir(home);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    try {
      if ((await stat(path)).size > MAX_LOG_BYTES) await rename(path, `${path}.1`);
    } catch {
      // まだ無い、など。追記側で作る
    }
    await appendFile(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  } catch {
    // 書けなくても送信の結果には影響させない
  }
}
