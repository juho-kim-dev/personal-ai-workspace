import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
await mkdir(".local", { recursive: true });
await build({
  entryPoints: ["tests/core.test.ts"],
  bundle: true,
  outfile: ".local/core.test.mjs",
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node22",
});
const result = spawnSync(process.execPath, ["--test", ".local/core.test.mjs"], {
  stdio: "inherit",
  env: { ...process.env, PAW_MCP_TEST: "1" },
});
process.exitCode = result.status ?? 1;
