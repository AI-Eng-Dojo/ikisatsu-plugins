import { handleStop } from "../claude-code/stop.ts";
import { runHookEntry } from "../lib/entry.ts";

await runHookEntry(handleStop);
