import { handleCodexSessionEnd } from "../codex/session-end.ts";
import { runHookEntry } from "../lib/entry.ts";

await runHookEntry(handleCodexSessionEnd);
