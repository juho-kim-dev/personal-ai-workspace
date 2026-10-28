import { build } from "esbuild";
import { mkdir, copyFile, cp, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await mkdir(".local", { recursive: true });
await build({
  entryPoints: ["src/app.tsx"],
  bundle: true,
  outfile: "dist/app.js",
  format: "esm",
  jsx: "automatic",
  minify: true,
  legalComments: "linked",
  target: "es2022",
  metafile: true,
}).then((r) =>
  writeFile(".local/build-inputs.json", JSON.stringify(r.metafile, null, 2)),
);
await copyFile("index.html", "dist/index.html");
await cp("assets", "dist/assets", { recursive: true });
await mkdir("dist/engine", { recursive: true });
for (const name of ["rhwp_bg.wasm", "LICENSE"])
  await copyFile(`components/documents/engine/${name}`, `dist/engine/${name}`);
await cp("licenses", "dist/licenses", { recursive: true });
await copyFile("LICENSE", "dist/LICENSE.txt");
await copyFile("provenance.json", "dist/provenance.json");
await build({
  entryPoints: ["src/mcp.ts"],
  bundle: true,
  outfile: "dist/mcp.mjs",
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});
console.log("Built six-role demo and local read-only MCP adapter.");
