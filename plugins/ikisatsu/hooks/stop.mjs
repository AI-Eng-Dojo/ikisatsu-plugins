// src/claude-code/stop.ts
import { readFile as readFile3 } from "node:fs/promises";

// src/lib/diag-log.ts
import { appendFile, chmod as chmod2, mkdir as mkdir2, rename as rename2, stat } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/lib/token.ts
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
function tokenDir(home) {
  return join(home, ".ikisatsu");
}
function tokenFilePath(home) {
  return join(tokenDir(home), "token");
}
async function readTokenWithSource(env, home) {
  const fromEnv = env.IKISATSU_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  try {
    const fromFile = (await readFile(tokenFilePath(home), "utf-8")).trim();
    return fromFile === "" ? null : { token: fromFile, source: "file" };
  } catch {
    return null;
  }
}

// src/lib/diag-log.ts
var MAX_LOG_BYTES = 512 * 1024;
function logDir(home) {
  return join2(tokenDir(home), "logs");
}
function httpErrorLogPath(home) {
  return join2(logDir(home), "http-errors.log");
}
async function appendHttpFailure(home, line) {
  await appendLine(home, httpErrorLogPath(home), line);
}
async function appendLine(home, path, line) {
  try {
    const dir = logDir(home);
    await mkdir2(dir, { recursive: true, mode: 448 });
    await chmod2(dir, 448);
    try {
      if ((await stat(path)).size > MAX_LOG_BYTES) await rename2(path, `${path}.1`);
    } catch {
    }
    await appendFile(path, `${JSON.stringify(line)}
`, { mode: 384 });
    await chmod2(path, 384);
  } catch {
  }
}

// src/lib/http.ts
var USER_AGENT = "ikisatsu-hooks";
var BODY_HEAD_CHARS = 300;
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
function isControl(ch) {
  const code = ch.codePointAt(0) ?? 0;
  return code < 32 || code === 127 || code === 8232 || code === 8233;
}
function bodyHead(text) {
  return Array.from(text.slice(0, BODY_HEAD_CHARS), (ch) => isControl(ch) ? " " : ch).join("");
}
async function request(options) {
  const doFetch = options.fetchImpl ?? fetch;
  const headers = { "user-agent": USER_AGENT };
  if (options.token !== void 0) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== void 0) headers["content-type"] = "application/json";
  const { diagnostics } = options;
  let res;
  try {
    res = await doFetch(options.url, {
      method: options.method,
      headers,
      body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs)
    });
  } catch (err) {
    if (diagnostics) {
      const e = err instanceof Error ? err : void 0;
      const cause = e?.cause ?? void 0;
      await appendHttpFailure(diagnostics.home, {
        at: (/* @__PURE__ */ new Date()).toISOString(),
        hook: diagnostics.hook,
        method: options.method,
        path: pathOf(options.url),
        tokenSource: diagnostics.tokenSource,
        error: e?.name ?? "UnknownError",
        code: typeof cause?.code === "string" ? cause.code : void 0
      });
    }
    throw err;
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = void 0;
  }
  if (!res.ok && diagnostics) {
    await appendHttpFailure(diagnostics.home, {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      hook: diagnostics.hook,
      method: options.method,
      path: pathOf(options.url),
      tokenSource: diagnostics.tokenSource,
      status: res.status,
      cfRay: res.headers.get("cf-ray"),
      server: res.headers.get("server"),
      cfMitigated: res.headers.get("cf-mitigated"),
      contentType: res.headers.get("content-type"),
      bodyHead: bodyHead(text)
    });
  }
  return { status: res.status, ok: res.ok, json };
}

// src/lib/authed-request.ts
async function authedRequest(ctx, deps, hook, options) {
  const first = await request({
    ...options,
    token: ctx.token,
    fetchImpl: deps.fetchImpl,
    diagnostics: { home: deps.home, hook, tokenSource: ctx.tokenSource }
  });
  if (first.status !== 401 || ctx.tokenSource !== "env") return first;
  const fromFile = await readTokenWithSource({}, deps.home);
  if (fromFile === null || fromFile.token === ctx.token) return first;
  return request({
    ...options,
    token: fromFile.token,
    fetchImpl: deps.fetchImpl,
    diagnostics: { home: deps.home, hook, tokenSource: fromFile.source }
  });
}

// ../../packages/core/src/transcript.ts
var TRANSCRIPT_LIMITS = {
  maxEntries: 5e3,
  maxTextChars: 2e4,
  maxBodyBytes: 5 * 1024 * 1024
};
var SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
var PROJECT_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
function isValidSessionId(value) {
  return SESSION_ID_PATTERN.test(value);
}
function isValidProjectId(value) {
  return PROJECT_ID_PATTERN.test(value) && value !== "." && value !== "..";
}

// src/lib/fit-upload.ts
var ENVELOPE_MARGIN_BYTES = 1024;
function fitEntries(entries) {
  const byCount = entries.slice(-TRANSCRIPT_LIMITS.maxEntries);
  const budget = TRANSCRIPT_LIMITS.maxBodyBytes - ENVELOPE_MARGIN_BYTES;
  let total = 0;
  let start = byCount.length;
  for (let i = byCount.length - 1; i >= 0; i--) {
    const entry = byCount[i];
    if (entry === void 0) continue;
    total += Buffer.byteLength(JSON.stringify(entry), "utf-8") + 1;
    if (total > budget) break;
    start = i;
  }
  return byCount.slice(start);
}

// src/lib/config.ts
import { readFile as readFile2 } from "node:fs/promises";
import { dirname, join as join3 } from "node:path";
var DEFAULT_API_URL = "https://api.ikisatsu.dev";
function baseUrl(value, fallback) {
  const raw = value?.trim() || fallback;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("URL \u306E\u30B9\u30AD\u30FC\u30E0\u306F http \u304B https \u306E\u307F");
  }
  return raw.replace(/\/+$/, "");
}
function apiBaseUrl(env) {
  return baseUrl(env.IKISATSU_API_URL, DEFAULT_API_URL);
}
async function readProjectId(path) {
  try {
    const parsed = JSON.parse(await readFile2(path, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const id = parsed.projectId;
    return typeof id === "string" && isValidProjectId(id) ? id : null;
  } catch {
    return null;
  }
}
async function findProjectConfig(startDir) {
  let dir = startDir;
  for (; ; ) {
    const projectId = await readProjectId(join3(dir, ".ikisatsu.json"));
    if (projectId !== null) return { projectId, root: dir };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// src/lib/hook-context.ts
async function resolveHookContext(input, deps, options) {
  if (input === null) return null;
  const rawSessionId = input.session_id;
  const sessionId = typeof rawSessionId === "string" && isValidSessionId(rawSessionId) ? rawSessionId : "";
  if (options.requireSessionId && sessionId === "") return null;
  const cwd = typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : deps.cwd;
  const project = await findProjectConfig(cwd);
  if (project === null) return null;
  const token = await readTokenWithSource(deps.env, deps.home);
  if (token === null) return null;
  return {
    token: token.token,
    tokenSource: token.source,
    apiUrl: apiBaseUrl(deps.env),
    projectId: project.projectId,
    repoRoot: project.root,
    sessionId,
    cwd
  };
}

// src/lib/last-assistant-message.ts
function withLastAssistantMessage(entries, lastAssistantMessage) {
  if (typeof lastAssistantMessage !== "string") return [...entries];
  const message = lastAssistantMessage.trim();
  if (message === "") return [...entries];
  let lastUser = -1;
  entries.forEach((e, i) => {
    if (e.kind === "user") lastUser = i;
  });
  const alreadyThere = entries.slice(lastUser + 1).some((e) => e.kind === "assistant" && e.text.trim() === message);
  if (alreadyThere) return [...entries];
  return [
    ...entries,
    { kind: "assistant", text: message.slice(0, TRANSCRIPT_LIMITS.maxTextChars) }
  ];
}

// src/claude-code/filter-transcript.ts
import { posix } from "node:path";
var MAX_TARGET_CHARS = 500;
var MAX_NAME_CHARS = 200;
var MAX_AT_CHARS = 64;
var STRIPPED_TAGS = [
  "system-reminder",
  "local-command-stdout",
  "local-command-stderr",
  "local-command-caveat",
  "bash-input",
  "bash-stdout",
  "bash-stderr"
];
var STRIP_PATTERN = new RegExp(
  STRIPPED_TAGS.map((t) => `<${t}>[\\s\\S]*?(?:</${t}>|$)`).join("|"),
  "g"
);
var PATH_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "Read", "NotebookEdit"]);
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function clip(text, max) {
  return text.length > max ? text.slice(0, max) : text;
}
function cleanUserText(raw) {
  return raw.replace(STRIP_PATTERN, "").trim();
}
function toRepoRelative(filePath, repoRoot) {
  const isAbsolute = (p2) => p2.startsWith("/") || /^[A-Za-z]:\//.test(p2);
  const p = posix.normalize(filePath.replaceAll("\\", "/"));
  if (!isAbsolute(p)) {
    return p === "." || p === ".." || p.startsWith("../") ? void 0 : p;
  }
  const root = posix.normalize(repoRoot.replaceAll("\\", "/")).replace(/\/+$/, "");
  if (!p.startsWith(`${root}/`)) return void 0;
  return p.slice(root.length + 1);
}
function toolTarget(name, input, repoRoot) {
  if (PATH_TOOLS.has(name)) {
    const path = input.file_path ?? (name === "NotebookEdit" ? input.notebook_path : void 0);
    if (typeof path !== "string") return void 0;
    const rel = toRepoRelative(path, repoRoot);
    return rel === void 0 ? void 0 : clip(rel, MAX_TARGET_CHARS);
  }
  if (name === "Bash") {
    const desc = input.description;
    return typeof desc === "string" && desc.trim() !== "" ? clip(desc.trim(), MAX_TARGET_CHARS) : void 0;
  }
  return void 0;
}
function textBlocks(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts;
}
function parseLine(raw) {
  if (raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function filterClaudeCodeTranscript(jsonlText, options) {
  const entries = [];
  for (const raw of jsonlText.split("\n")) {
    const row = parseLine(raw);
    if (!row) continue;
    if (row.isSidechain === true || row.isMeta === true) continue;
    if (row.type !== "user" && row.type !== "assistant") continue;
    const message = row.message;
    if (!isRecord(message)) continue;
    const at = typeof row.timestamp === "string" && row.timestamp.length <= MAX_AT_CHARS ? { at: row.timestamp } : {};
    if (row.type === "user") {
      for (const t of textBlocks(message.content)) {
        const text = cleanUserText(t);
        if (text === "") continue;
        entries.push({ kind: "user", text: clip(text, TRANSCRIPT_LIMITS.maxTextChars), ...at });
      }
      continue;
    }
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text === "") continue;
        entries.push({
          kind: "assistant",
          text: clip(text, TRANSCRIPT_LIMITS.maxTextChars),
          ...at
        });
      } else if (block.type === "tool_use" && typeof block.name === "string" && block.name !== "") {
        const input = isRecord(block.input) ? block.input : {};
        const target = toolTarget(block.name, input, options.repoRoot);
        entries.push({
          kind: "tool",
          name: clip(block.name, MAX_NAME_CHARS),
          ...target === void 0 ? {} : { target },
          ...at
        });
      }
    }
  }
  return entries;
}

// src/claude-code/stop.ts
var STOP_TIMEOUT_MS = 1e4;
async function handleStop(input, deps) {
  const ctx = await resolveHookContext(input, deps, { requireSessionId: true });
  if (ctx === null || input === null) return;
  const transcriptPath = input.transcript_path;
  if (typeof transcriptPath !== "string" || transcriptPath === "") return;
  let jsonl;
  try {
    jsonl = await readFile3(transcriptPath, "utf-8");
  } catch {
    return;
  }
  const filtered = filterClaudeCodeTranscript(jsonl, { repoRoot: ctx.repoRoot });
  const entries = fitEntries(withLastAssistantMessage(filtered, input.last_assistant_message));
  if (entries.length === 0) return;
  const body = { projectId: ctx.projectId, tool: "claude-code", entries };
  await authedRequest(ctx, deps, "claude-code-stop", {
    method: "PUT",
    url: `${ctx.apiUrl}/v1/transcripts/${ctx.sessionId}`,
    body,
    timeoutMs: deps.timeoutMs ?? STOP_TIMEOUT_MS
  });
}

// src/lib/entry.ts
import { homedir } from "node:os";

// src/lib/fail-open.ts
var defaultDeps = { exit: (code) => process.exit(code), deadlineMs: 2e4 };
async function runFailOpen(main, deps = defaultDeps) {
  const timer = setTimeout(() => {
    console.error("ikisatsu: \u6642\u9593\u5207\u308C\u306E\u305F\u3081\u4E2D\u65AD\u3057\u307E\u3057\u305F(\u30BB\u30C3\u30B7\u30E7\u30F3\u306B\u306F\u5F71\u97FF\u3057\u307E\u305B\u3093)");
    deps.exit(0);
  }, deps.deadlineMs);
  timer.unref();
  try {
    await main();
  } catch {
    console.error("ikisatsu: \u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F(\u30BB\u30C3\u30B7\u30E7\u30F3\u306B\u306F\u5F71\u97FF\u3057\u307E\u305B\u3093)");
  }
  clearTimeout(timer);
  deps.exit(0);
}

// src/lib/stdin.ts
async function readStdin(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
function parseHookInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// src/lib/entry.ts
function defaultHookDeps() {
  return { env: process.env, home: homedir(), cwd: process.cwd() };
}
async function runHookEntry(handler) {
  await runFailOpen(async () => {
    const input = parseHookInput(await readStdin());
    await handler(input, defaultHookDeps());
  });
}

// src/entries/claude-code-stop.ts
await runHookEntry(handleStop);
