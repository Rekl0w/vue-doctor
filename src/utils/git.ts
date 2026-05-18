import { spawnSync } from "node:child_process";
import { SOURCE_EXTENSIONS } from "../constants.js";
import type { DiffInfo } from "../types.js";

const DEFAULT_BRANCH_CANDIDATES = ["main", "master", "develop", "dev"];

const runGit = (cwd: string, args: string[]): string | null => {
  const result = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.toString().trim();
};

const runGitNullSeparated = (cwd: string, args: string[]): string[] | null => {
  const result = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout
    .toString()
    .split("\0")
    .filter((entry) => entry.length > 0);
};

const getCurrentBranch = (directory: string): string | null => {
  const branch = runGit(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") return null;
  return branch;
};

const detectDefaultBranch = (directory: string): string | null => {
  const remoteHead = runGit(directory, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (remoteHead) return remoteHead.replace("refs/remotes/origin/", "");

  const refs = DEFAULT_BRANCH_CANDIDATES.flatMap((candidate) => [
    `refs/heads/${candidate}`,
    `refs/remotes/origin/${candidate}`,
  ]);
  const output = runGit(directory, ["for-each-ref", "--format=%(refname:short)", ...refs]);
  return output?.split("\n")[0]?.trim() || null;
};

const refExists = (directory: string, reference: string): boolean => {
  const result = spawnSync("git", ["rev-parse", "--verify", reference], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return !result.error && result.status === 0;
};

const getChangedFilesSinceRef = (directory: string, baseRef: string): string[] | null => {
  const mergeBase = runGit(directory, ["merge-base", baseRef, "HEAD"]);
  if (!mergeBase) return null;
  return runGitNullSeparated(directory, [
    "diff",
    "-z",
    "--name-only",
    "--diff-filter=ACMR",
    "--relative",
    mergeBase,
  ]);
};

const getUncommittedChangedFiles = (directory: string): string[] =>
  runGitNullSeparated(directory, [
    "diff",
    "-z",
    "--name-only",
    "--diff-filter=ACMR",
    "--relative",
    "HEAD",
  ]) ?? [];

export const getStagedSourceFiles = (directory: string): string[] =>
  filterSourceFiles(
    runGitNullSeparated(directory, [
      "diff",
      "--cached",
      "-z",
      "--name-only",
      "--diff-filter=ACMR",
      "--relative",
    ]) ?? [],
  );

export const getDiffInfo = (directory: string, explicitBaseRef?: string): DiffInfo | null => {
  if (explicitBaseRef !== undefined && explicitBaseRef.trim().length === 0) {
    throw new Error("Diff base cannot be empty.");
  }

  const currentBranch = getCurrentBranch(directory);
  if (!currentBranch) return null;

  const baseBranch = explicitBaseRef ?? detectDefaultBranch(directory);
  if (!baseBranch) return null;

  if (explicitBaseRef && !refExists(directory, explicitBaseRef)) {
    throw new Error(`Diff base "${explicitBaseRef}" does not exist. Run git fetch before scanning.`);
  }

  if (currentBranch === baseBranch || currentBranch === baseBranch.replace(/^origin\//, "")) {
    const changedFiles = getUncommittedChangedFiles(directory);
    if (changedFiles.length === 0) return null;
    return { currentBranch, baseBranch, changedFiles, isCurrentChanges: true };
  }

  const changedFiles = getChangedFilesSinceRef(directory, baseBranch);
  if (!changedFiles) return null;
  return { currentBranch, baseBranch, changedFiles };
};

export const filterSourceFiles = (filePaths: string[]): string[] =>
  filePaths.filter((filePath) => SOURCE_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf("."))));
