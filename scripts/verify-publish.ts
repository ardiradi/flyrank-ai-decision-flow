import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Print file paths and counts only. Never echo a matching credential or file body.
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const forbidden = tracked.filter((name) => /(^|\/)(node_modules|\.data|dist)\//.test(name) || /(^|\/)\.env(?:\..*)?$/.test(name) && !name.endsWith(".env.example") || /\.zip$/i.test(name));
const patterns = [
  /sk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{20,}/,
  /gh[pousr]_[a-zA-Z0-9]{20,}/,
  /github_pat_[a-zA-Z0-9_]{20,}/,
  /hf_[a-zA-Z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /^[ \t]*(?:OPENAI_API_KEY|INNGEST_EVENT_KEY|INNGEST_SIGNING_KEY)[ \t]*=[ \t]*["']?[^\s"']{20,}/m,
];
const exposed: string[] = [];
for (const name of tracked) {
  if (/\.(png|jpg|jpeg|gif|webp|pdf|mp4|woff2?)$/i.test(name)) continue;
  const contents = await readFile(name, "utf8");
  if (patterns.some((pattern) => pattern.test(contents))) exposed.push(name);
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), trackedFiles: tracked.length, forbiddenPaths: forbidden, credentialMatches: exposed, passed: forbidden.length === 0 && exposed.length === 0 }, null, 2));
if (forbidden.length || exposed.length) process.exitCode = 1;
