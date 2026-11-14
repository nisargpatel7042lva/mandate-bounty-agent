import { loadEnv } from "./env.ts";
import { startAgent } from "./main.ts";

await startAgent(loadEnv());
