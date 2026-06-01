import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { canPrompt } from "./terminal.js";

const STATE_PATH = process.env.VUE_DOCTOR_SETUP_HINT_STORE
  ? path.resolve(process.env.VUE_DOCTOR_SETUP_HINT_STORE)
  : path.join(os.homedir(), ".vue-doctor", "setup-hints.json");
const PACKAGE_NAME = "@rekl0w/vue-doctor";

const readJsonFile = (filePath: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const projectKey = (rootDirectory: string): string =>
  createHash("sha256").update(path.resolve(rootDirectory).toLowerCase()).digest("hex").slice(0, 16);

const hasVueDoctorSetup = (rootDirectory: string): boolean => {
  const packageJson = readJsonFile(path.join(rootDirectory, "package.json"));
  if (!packageJson) return false;
  const scripts = typeof packageJson.scripts === "object" && packageJson.scripts !== null
    ? packageJson.scripts as Record<string, unknown>
    : {};
  const dependencies = typeof packageJson.dependencies === "object" && packageJson.dependencies !== null
    ? packageJson.dependencies as Record<string, unknown>
    : {};
  const devDependencies = typeof packageJson.devDependencies === "object" && packageJson.devDependencies !== null
    ? packageJson.devDependencies as Record<string, unknown>
    : {};

  return (
    Object.values(scripts).some((value) => typeof value === "string" && value.includes("vue-doctor")) ||
    PACKAGE_NAME in dependencies ||
    PACKAGE_NAME in devDependencies
  );
};

const isCodingAgentEnvironment = (): boolean => {
  const names = Object.keys(process.env).join(" ");
  return /\b(CODEX|CLAUDE|CURSOR|CLINE|GITHUB_COPILOT|AIDER|OPENAI)\b/i.test(names);
};

const readState = (): Record<string, true> => {
  const state = readJsonFile(STATE_PATH);
  return state ? Object.fromEntries(Object.keys(state).map((key) => [key, true])) : {};
};

const writeState = (state: Record<string, true>): void => {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
};

export const maybePrintSetupHint = (rootDirectory: string): void => {
  if (!canPrompt() || !isCodingAgentEnvironment() || hasVueDoctorSetup(rootDirectory)) return;

  const state = readState();
  const key = projectKey(rootDirectory);
  if (state[key]) return;

  console.log("");
  console.log(pc.bold("Vue Doctor is not installed in this project."));
  console.log("Ask the user if they would like to set it up, then run:");
  console.log("");
  console.log("  npx @rekl0w/vue-doctor@latest install --yes");
  console.log("");
  console.log(
    pc.dim(
      "This adds agent skill files, a `doctor` package script, Git hooks, a GitHub Actions workflow, and @rekl0w/vue-doctor as a dev dependency.",
    ),
  );
  state[key] = true;
  writeState(state);
};
