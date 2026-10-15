// 生の会話(発言だけに削ったもの)の型。サーバと手元のフックで共有する。
// 実行結果(tool の出力)は型として持たない: 持てない形にしておくことで、うっかり送れないようにする

export type TranscriptEntry =
  | { kind: "user"; text: string; at?: string }
  | { kind: "assistant"; text: string; at?: string }
  | { kind: "tool"; name: string; target?: string; at?: string };

export interface TranscriptUpload {
  /** リポジトリにコミットされた設定ファイルのプロジェクト ID */
  projectId: string;
  /** 会話を生んだツールの識別子(取り得る値の検証はサーバ側。core はツールの名前を知らない) */
  tool: string;
  entries: TranscriptEntry[];
}

export const TRANSCRIPT_LIMITS = {
  maxEntries: 5000,
  maxTextChars: 20000,
  maxBodyBytes: 5 * 1024 * 1024,
} as const;

/** `[A-Za-z0-9_-]{8,128}` */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
/** `[A-Za-z0-9._-]{1,100}`。`.` と `..` だけは別途 isValidProjectId で弾く */
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

export function isValidProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value) && value !== "." && value !== "..";
}
