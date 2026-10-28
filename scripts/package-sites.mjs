import {
  mkdir,
  copyFile,
  readdir,
  writeFile,
  readFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
// This is a neutral transfer directory, not an authenticated Sites deployment archive.
const output = ".local/sites-ready",
  entries = [];
async function copy(from, to, relative = "") {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name === "mcp.mjs") continue;
    if (
      !relative &&
      ![
        "assets",
        "engine",
        "licenses",
        "index.html",
        "app.js",
        "app.css",
        "app.js.LEGAL.txt",
        "LICENSE.txt",
        "provenance.json",
      ].includes(entry.name)
    )
      throw Error(`Unexpected build output: ${entry.name}`);
    const src = join(from, entry.name),
      dest = join(to, entry.name),
      path = (relative ? relative + "/" : "") + entry.name;
    if (entry.isDirectory()) await copy(src, dest, path);
    else {
      await copyFile(src, dest);
      const bytes = await readFile(src);
      entries.push({
        path,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await copy("dist", output + "/dist");
await copyFile("docs/DEPLOY-SITES.md", output + "/DEPLOY-SITES.md");
await copyFile(
  "sites/hosting.template.json",
  output + "/hosting.template.json",
);
await writeFile(
  output + "/manifest.json",
  JSON.stringify(
    {
      schema: 1,
      status: "prepared-not-deployed",
      staticDirectory: "dist",
      account: "secondary-account-only",
      files: entries,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${entries.length} static files in ${output}. No Site ID, credentials, private data or account connection included.`,
);
