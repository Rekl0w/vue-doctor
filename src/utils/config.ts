import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAMES, DEFAULT_FAIL_ON } from "../constants.js";
import type { FailOnLevel, RuleLevel, VueDoctorConfig } from "../types.js";

export interface LoadedConfig {
  config: VueDoctorConfig;
  sourcePath: string | null;
  rootDirectory: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonFile = (filePath: string): Record<string, unknown> | null => {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length === value.length ? strings : undefined;
};

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asPositiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;

const asFailOn = (value: unknown): FailOnLevel | undefined => {
  if (value === "error" || value === "warning" || value === "none") return value;
  return undefined;
};

const asRuleLevelMap = (value: unknown): Record<string, RuleLevel> | undefined => {
  if (!isObject(value)) return undefined;
  const result: Record<string, RuleLevel> = {};
  for (const [rule, level] of Object.entries(value)) {
    if (level === "error" || level === "warning" || level === "off") {
      result[rule] = level;
    }
  }
  return result;
};

const normalizeConfig = (raw: Record<string, unknown>): VueDoctorConfig => {
  const ignore = isObject(raw.ignore) ? raw.ignore : {};
  const overrides = Array.isArray(ignore.overrides)
    ? ignore.overrides
        .filter(isObject)
        .map((override) => ({
          files: asStringArray(override.files) ?? [],
          rules: asStringArray(override.rules),
        }))
        .filter((override) => override.files.length > 0)
    : undefined;

  return {
    rootDir: typeof raw.rootDir === "string" ? raw.rootDir : undefined,
    verbose: asBoolean(raw.verbose),
    failOn: asFailOn(raw.failOn) ?? DEFAULT_FAIL_ON,
    include: asStringArray(raw.include),
    maxComponentLines: asPositiveInteger(raw.maxComponentLines),
    maxProps: asPositiveInteger(raw.maxProps),
    respectInlineDisables: asBoolean(raw.respectInlineDisables),
    rules: asRuleLevelMap(raw.rules),
    ignore: {
      rules: asStringArray(ignore.rules),
      files: asStringArray(ignore.files),
      overrides,
    },
  };
};

const findUp = (startDirectory: string, filenames: string[]): string | null => {
  let current = path.resolve(startDirectory);
  while (true) {
    for (const filename of filenames) {
      const candidate = path.join(current, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const loadPackageJsonConfig = (startDirectory: string): { path: string; raw: Record<string, unknown> } | null => {
  const packageJsonPath = findUp(startDirectory, ["package.json"]);
  if (!packageJsonPath) return null;
  const packageJson = readJsonFile(packageJsonPath);
  if (!packageJson || !isObject(packageJson.vueDoctor)) return null;
  return { path: packageJsonPath, raw: packageJson.vueDoctor };
};

export const loadConfig = (directory: string, explicitConfigPath?: string): LoadedConfig => {
  const requestedDirectory = path.resolve(directory);
  const explicitPath = explicitConfigPath ? path.resolve(explicitConfigPath) : null;
  const configPath = explicitPath ?? findUp(requestedDirectory, CONFIG_FILENAMES);

  let sourcePath: string | null = null;
  let rawConfig: Record<string, unknown> = {};

  if (configPath) {
    rawConfig = readJsonFile(configPath) ?? {};
    sourcePath = configPath;
  } else {
    const packageConfig = loadPackageJsonConfig(requestedDirectory);
    if (packageConfig) {
      rawConfig = packageConfig.raw;
      sourcePath = packageConfig.path;
    }
  }

  const config = normalizeConfig(rawConfig);
  const sourceDirectory = sourcePath ? path.dirname(sourcePath) : requestedDirectory;
  const rootDirectory = config.rootDir
    ? path.resolve(sourceDirectory, config.rootDir)
    : requestedDirectory;

  return { config, sourcePath, rootDirectory };
};

export const mergeConfig = (
  loadedConfig: VueDoctorConfig,
  override: VueDoctorConfig | null | undefined,
): VueDoctorConfig => {
  if (!override) return loadedConfig;
  return {
    ...loadedConfig,
    ...override,
    ignore: {
      ...loadedConfig.ignore,
      ...override.ignore,
      rules: override.ignore?.rules ?? loadedConfig.ignore?.rules,
      files: override.ignore?.files ?? loadedConfig.ignore?.files,
      overrides: override.ignore?.overrides ?? loadedConfig.ignore?.overrides,
    },
    rules: {
      ...loadedConfig.rules,
      ...override.rules,
    },
  };
};
