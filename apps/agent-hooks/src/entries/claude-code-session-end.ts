import { handleSessionEnd } from "../claude-code/session-end.ts";
import { runHookEntry } from "../lib/entry.ts";

await runHookEntry(handleSessionEnd);
