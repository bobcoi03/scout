import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const patterns = [
  { label: "OpenAI API key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "GitHub token", pattern: /\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/ },
  { label: "Vercel Blob token", pattern: /\bvercel_blob_rw_[A-Za-z0-9_-]{20,}\b/ },
  { label: "Vercel access token", pattern: /\b(?:VERCEL_TOKEN|VERCEL_OIDC_TOKEN)[ \t]*[:=][ \t]*["']?[A-Za-z0-9._-]{24,}/ },
  { label: "configured sensitive environment value", pattern: /\b(?:BLOB_READ_WRITE_TOKEN|SCOUT_STATE_READ_WRITE_TOKEN|CRON_SECRET|OAI_API_KEY|OPENAI_API_KEY|X_AUTH_TOKEN|X_CT0)[ \t]*[:=][ \t]*["']?(?!\.\.\.|<|\$|process\.env)[A-Za-z0-9_./+=-]{16,}/ },
  { label: "X auth cookie", pattern: /\bauth_token=[A-Za-z0-9_-]{24,}\b/ },
  { label: "X csrf cookie", pattern: /\bct0=[A-Za-z0-9_-]{24,}\b/ },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
] as const;

const trackedFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings: Array<{ source: string; label: string }> = [];

function scanContent(source: string, buffer: Buffer) {
  if (buffer.includes(0)) return;
  const content = buffer.toString("utf8");
  for (const { label, pattern } of patterns) {
    if (pattern.test(content)) findings.push({ source, label });
  }
}

for (const file of trackedFiles) {
  const stats = fs.statSync(file);
  if (!stats.isFile() || stats.size > 5_000_000) continue;
  scanContent(file, fs.readFileSync(file));
}

const historyLines = execFileSync("git", ["rev-list", "--objects", "--all"], { encoding: "utf8" }).split("\n").filter(Boolean);
const historyObjects = new Map<string, string>();
for (const line of historyLines) {
  const [objectId, ...pathParts] = line.split(" ");
  if (objectId && !historyObjects.has(objectId)) historyObjects.set(objectId, pathParts.join(" ") || "(unknown path)");
}
const objectIds = [...historyObjects.keys()];
const batch = spawnSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
  input: `${objectIds.join("\n")}\n`,
  encoding: "utf8",
  maxBuffer: 20_000_000,
});
if (batch.status !== 0) throw new Error("Could not inspect Git history objects");
for (const line of batch.stdout.split("\n")) {
  const [objectId, type, sizeValue] = line.split(" ");
  const size = Number(sizeValue);
  if (type !== "blob" || !Number.isFinite(size) || size > 5_000_000) continue;
  const buffer = execFileSync("git", ["cat-file", "blob", objectId], { encoding: "buffer", maxBuffer: 5_100_000 });
  scanContent(`history:${objectId.slice(0, 12)}:${historyObjects.get(objectId)}`, buffer);
}

if (findings.length) {
  console.error("Potential secrets found:");
  for (const finding of findings) console.error(`- ${finding.source}: ${finding.label}`);
  process.exitCode = 1;
} else {
  console.log(`Secret preflight passed for ${trackedFiles.length} publishable files and ${historyObjects.size} Git objects.`);
}
