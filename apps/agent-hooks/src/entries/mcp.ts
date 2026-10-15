import { homedir } from "node:os";
import { runMcpProxy } from "../mcp/proxy.ts";

await runMcpProxy({ env: process.env, home: homedir(), cwd: process.cwd() });
