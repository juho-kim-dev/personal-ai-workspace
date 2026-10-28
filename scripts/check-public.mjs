import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const forbidden = [
  /\.env(?:\.|$)/,
  /\.(?:sqlite|db|pem|key|log)$/i,
  /^(?:\.local|node_modules|dist|\.wrangler)\//,
  /^\.openai\/hosting\.json$/,
  /^\.github\/workflows\//,
];
const privateMarkers = [
  new RegExp("ju" + "hile\\.chatgpt\\.site", "i"),
  new RegExp("Coca" + "Pls/", "i"),
  new RegExp("C:[/\\\\]Users[/\\\\]", "i"),
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const errors = [];
for (const file of files) {
  if (forbidden.some((r) => r.test(file)))
    errors.push(`Forbidden path: ${file}`);
  const info = await stat(file);
  if (info.size > 20 * 1024 * 1024) errors.push(`Oversized file: ${file}`);
  if (/\.(?:wasm|webm|png|jpg)$/.test(file)) continue;
  const text = await readFile(file, "utf8");
  for (const rule of privateMarkers)
    if (rule.test(text)) errors.push(`Private marker: ${file}`);
}
const provenance = JSON.parse(await readFile("provenance.json", "utf8"));
for (const entry of provenance.files) {
  const hash = createHash("sha256")
    .update(await readFile(entry.path))
    .digest("hex");
  if (hash !== entry.sha256)
    errors.push(`Provenance hash changed: ${entry.path}`);
}
assert.equal(errors.length, 0, errors.join("\n"));
console.log(
  `Public boundary passed: ${files.length} selected files; ${provenance.files.length} provenance hashes match. Heuristic scan, not a proof against every secret.`,
);
