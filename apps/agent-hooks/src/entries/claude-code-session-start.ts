import { handleSessionStart } from "../claude-code/session-start.ts";
import { runHookEntry } from "../lib/entry.ts";

await runHookEntry(handleSessionStart);
