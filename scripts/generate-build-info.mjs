import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const outputPath = resolve(root, "src/shared/config/buildInfo.ts");

function readGitValue(command) {
  try {
    return execSync(command, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const buildInfo = {
  appVersion: packageJson.version ?? "0.0.0",
  buildDate: new Date().toISOString(),
  gitBranch: readGitValue("git rev-parse --abbrev-ref HEAD"),
  gitCommit: readGitValue("git rev-parse --short HEAD"),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  [
    "export const buildInfo = {",
    `  appVersion: ${JSON.stringify(buildInfo.appVersion)},`,
    `  buildDate: ${JSON.stringify(buildInfo.buildDate)},`,
    `  gitBranch: ${JSON.stringify(buildInfo.gitBranch)},`,
    `  gitCommit: ${JSON.stringify(buildInfo.gitCommit)},`,
    "} as const;",
    "",
  ].join("\n"),
);

console.log(`Generated build info: ${buildInfo.appVersion} ${buildInfo.gitCommit} ${buildInfo.buildDate}`);
