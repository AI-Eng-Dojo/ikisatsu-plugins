import { handleSessionStart } from "../codex/session-start.ts";
import { runHookEntry } from "../lib/entry.ts";

await runHookEntry(handleSessionStart);
