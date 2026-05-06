import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const ignoredDirs = new Set([".git", "node_modules", "dist", "coverage"]);
const allowedFiles = new Set([".env.example"]);

const forbiddenPatterns: Array<[RegExp, string]> = [
  [/iotaprivkey[1-9A-HJ-NP-Za-km-z]{20,}/, "IOTA private key"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key block"],
  [/(?:mnemonic|seed[_-]?phrase)\s*[:=]/i, "wallet mnemonic or seed phrase"],
];

const credentialAssignment =
  /^\s*(?:[A-Z0-9_]*(?:API_KEY|BEARER_TOKEN|JWT_SECRET|PRIVATE_KEY|KEYPAIR|AUTH)[A-Z0-9_]*)\s*=\s*(?!replace-with|placeholder|redacted)([A-Za-z0-9._~+/=-]{20,})\s*$/i;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

const findings: string[] = [];

for await (const file of walk(root)) {
  const relative = file.slice(root.length);
  if (allowedFiles.has(relative)) continue;
  const fileStat = await stat(file);
  if (fileStat.size > 1_000_000) continue;
  const text = await readFile(file, "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    if (credentialAssignment.test(line)) {
      findings.push(`${relative}: possible credential assignment`);
      break;
    }
  }
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(text)) {
      findings.push(`${relative}: possible ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}

console.log("No obvious secret patterns found in tracked project files.");
