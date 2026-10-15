import { defaultLoginDeps, runLogin } from "../login/login.ts";

process.exit(await runLogin(defaultLoginDeps()));
