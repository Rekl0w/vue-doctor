import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";
import { DEFAULT_IGNORES, IGNORE_FILENAMES, SOURCE_EXTENSIONS } from "../constants.js";
import type { VueDoctorConfig } from "../types.js";
import { toPosixPath } from "./path.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".nuxt",
  ".output",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

interface DiscoverOptions {
  ignoreConfigFiles?: boolean;
}

const isSourceFile = (filePath: string): boolean => SOURCE_EXTENSIONS.has(path.extname(filePath));

const readIgnorePatterns = (rootDirectory: string, config?: VueDoctorConfig, options?: DiscoverOptions): string[] => {
  const patterns = [...DEFAULT_IGNORES];
  if (!options?.ignoreConfigFiles) {
    for (const filename of IGNORE_FILENAMES) {
      const ignorePath = path.join(rootDirectory, filename);
      if (fs.existsSync(ignorePath)) {
        patterns.push(fs.readFileSync(ignorePath, "utf-8"));
      }
    }
  }
  patterns.push(...(config?.ignore?.files ?? []));
  return patterns;
};

const createIgnoreFilter = (rootDirectory: string, config?: VueDoctorConfig, options?: DiscoverOptions) => {
  const matcher = ignore().add(readIgnorePatterns(rootDirectory, config, options));
  return (filePath: string): boolean => {
    const relativePath = toPosixPath(path.relative(rootDirectory, filePath));
    return matcher.ignores(relativePath);
  };
};

const listGitFiles = (rootDirectory: string): string[] | null => {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: rootDirectory,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) return null;
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((relativePath) => path.resolve(rootDirectory, relativePath));
};

const walkDirectory = (directory: string): string[] => {
  const files: string[] = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
        files.push(...walkDirectory(fullPath));
      }
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
};

const expandIncludePath = (rootDirectory: string, includePath: string): string[] => {
  const resolvedPath = path.resolve(rootDirectory, includePath);
  if (!fs.existsSync(resolvedPath)) return [];
  const stat = fs.statSync(resolvedPath);
  if (stat.isFile()) return [resolvedPath];
  if (stat.isDirectory()) return walkDirectory(resolvedPath);
  return [];
};

export const discoverSourceFiles = (
  rootDirectory: string,
  includePaths: string[] = [],
  options: DiscoverOptions = {},
  config?: VueDoctorConfig,
): string[] => {
  const shouldIgnore = createIgnoreFilter(rootDirectory, config, options);
  const candidates =
    includePaths.length > 0
      ? includePaths.flatMap((includePath) => expandIncludePath(rootDirectory, includePath))
      : (listGitFiles(rootDirectory) ?? walkDirectory(rootDirectory));

  return candidates
    .filter((filePath) => isSourceFile(filePath))
    .map((filePath) => path.resolve(filePath))
    .filter((filePath) => !shouldIgnore(filePath))
    .sort((left, right) => left.localeCompare(right));
};
