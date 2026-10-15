// API / Web の URL と、リポジトリの .ikisatsu.json(プロジェクト ID)の探索

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isValidProjectId } from "@ikisatsu/core";

export const DEFAULT_API_URL = "https://api.ikisatsu.dev";
export const DEFAULT_APP_URL = "https://app.ikisatsu.dev";

function baseUrl(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL のスキームは http か https のみ");
  }
  return raw.replace(/\/+$/, "");
}

/** `IKISATSU_API_URL`(既定 https://api.ikisatsu.dev)。末尾のスラッシュは落とす */
export function apiBaseUrl(env: NodeJS.ProcessEnv): string {
  return baseUrl(env.IKISATSU_API_URL, DEFAULT_API_URL);
}

/** `IKISATSU_APP_URL`(既定 https://app.ikisatsu.dev) */
export function appBaseUrl(env: NodeJS.ProcessEnv): string {
  return baseUrl(env.IKISATSU_APP_URL, DEFAULT_APP_URL);
}

export interface ProjectConfig {
  projectId: string;
  /** .ikisatsu.json のあるディレクトリ(リポジトリのルート) */
  root: string;
}

async function readProjectId(path: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const id = (parsed as Record<string, unknown>).projectId;
    return typeof id === "string" && isValidProjectId(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * startDir から親へ向かって .ikisatsu.json を探す。無い / 壊れている / projectId が不正なら null
 * (呼び出し側は「そのリポジトリでは ikisatsu を使っていない」として何もしない)。
 * 壊れたファイルで止まらず、その親も探す(サブディレクトリ側の設定が優先)
 */
export async function findProjectConfig(startDir: string): Promise<ProjectConfig | null> {
  let dir = startDir;
  for (;;) {
    const projectId = await readProjectId(join(dir, ".ikisatsu.json"));
    if (projectId !== null) return { projectId, root: dir };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
