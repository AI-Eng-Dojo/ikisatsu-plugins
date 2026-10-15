// packages/core: ツール非依存の型と純関数。

/** core の版。骨組みの疎通確認用。 */
export const CORE_VERSION = "0.0.0";

/** API が返すエラーの形。サーバと手元のフックで共有する。 */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export * from "./digest.ts";
export * from "./graph.ts";
export * from "./graph-validate.ts";
export * from "./graph-view.ts";
export * from "./injection-domain.ts";
export * from "./transcript.ts";
