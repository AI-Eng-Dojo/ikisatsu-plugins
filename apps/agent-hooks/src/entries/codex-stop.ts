import { handleCodexStop } from "../codex/stop.ts";
import { runHookEntry } from "../lib/entry.ts";

await runHookEntry(handleCodexStop);
