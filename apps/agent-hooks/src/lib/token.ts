// API トークン: 読み出し(IKISATSU_TOKEN → ~/.ikisatsu/token)と、login による保存

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function tokenDir(home: string): string {
  return join(home, ".ikisatsu");
}

export function tokenFilePath(home: string): string {
  return join(tokenDir(home), "token");
}

/** トークンをどこから読んだか。診断ログに残す(値は残さない)。長生きするプロセスの環境変数に古い値が残ると、ファイルを新しくしても効かないため(#79) */
export type TokenSource = "env" | "file";

/** 環境変数 → ファイルの順。空・読めないなら null */
export async function readTokenWithSource(
  env: NodeJS.ProcessEnv,
  home: string,
): Promise<{ token: string; source: TokenSource } | null> {
  const fromEnv = env.IKISATSU_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  try {
    const fromFile = (await readFile(tokenFilePath(home), "utf-8")).trim();
    return fromFile === "" ? null : { token: fromFile, source: "file" };
  } catch {
    return null;
  }
}

export async function readToken(env: NodeJS.ProcessEnv, home: string): Promise<string | null> {
  return (await readTokenWithSource(env, home))?.token ?? null;
}

/** ディレクトリ 0700 / ファイル 0600 で保存する。一時ファイル経由で置き換える(途中で壊れたトークンを残さない) */
export async function writeToken(token: string, home: string): Promise<string> {
  const dir = tokenDir(home);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = tokenFilePath(home);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${token}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  return path;
}
