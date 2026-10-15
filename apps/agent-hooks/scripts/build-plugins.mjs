// apps/agent-hooks/src(TypeScript)を、プラグイン配布用の依存ゼロ単一 JS にバンドルする。
// 出力(plugins/**/*.mjs)はリポジトリにコミットする成果物(.gitignore の対象外)。CI が鮮度を確認する
// (`npm run build --workspace=apps/agent-hooks` → `git diff --exit-code -- plugins`)。
//
// 出力を .mjs にしているのは、配布先に package.json の `"type": "module"` が無い前提でも
// Node に ESM として確実に解釈させるため。
//
// 新しいプラグイン・フックを足すときは OUTPUTS に 1 行足すだけ(例: #52 の Codex)

import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** entry は apps/agent-hooks からの相対、out はリポジトリルートからの相対 */
export const OUTPUTS = [
  { entry: "src/entries/claude-code-stop.ts", out: "plugins/ikisatsu/hooks/stop.mjs" },
  {
    entry: "src/entries/claude-code-session-end.ts",
    out: "plugins/ikisatsu/hooks/session-end.mjs",
  },
  {
    entry: "src/entries/claude-code-session-start.ts",
    out: "plugins/ikisatsu/hooks/session-start.mjs",
  },
  { entry: "src/entries/login.ts", out: "plugins/ikisatsu/bin/login.mjs" },
  { entry: "src/entries/mcp.ts", out: "plugins/ikisatsu/bin/mcp.mjs" },
  {
    entry: "src/entries/codex-session-start.ts",
    out: "plugins/ikisatsu-codex/hooks/session-start.mjs",
  },
  { entry: "src/entries/codex-stop.ts", out: "plugins/ikisatsu-codex/hooks/stop.mjs" },
  {
    entry: "src/entries/codex-session-end.ts",
    out: "plugins/ikisatsu-codex/hooks/session-end.mjs",
  },
  { entry: "src/entries/login.ts", out: "plugins/ikisatsu-codex/bin/login.mjs" },
  { entry: "src/entries/mcp.ts", out: "plugins/ikisatsu-codex/bin/mcp.mjs" },
];

const appDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// out(リポジトリルートからの相対)をそのまま outdir=リポジトリルート配下に置く
await build({
  absWorkingDir: appDir,
  entryPoints: OUTPUTS.map(({ entry, out }) => ({ in: entry, out: out.replace(/\.mjs$/, "") })),
  outdir: repoRoot,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  // 依存はすべて同梱する(配布先に node_modules は無い)
  logLevel: "info",
});
