import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parse } from "@vue/compiler-sfc";
import { minimatch } from "minimatch";
import { PLUGIN_NAME, VERSION } from "./constants.js";
import { normalizeRuleName, ruleByName } from "./rules/index.js";
import { scanScript } from "./rules/script.js";
import { scanSfcStructure } from "./rules/sfc.js";
import { scanTemplate } from "./rules/template.js";
import type {
  Diagnostic,
  DiagnosticInput,
  DiagnoseOptions,
  DiagnoseResult,
  JsonReport,
  ProjectInfo,
  RuleLevel,
  ScanContext,
  Severity,
  VueDoctorConfig,
} from "./types.js";
import { loadConfig, mergeConfig } from "./utils/config.js";
import { discoverProject } from "./utils/project.js";
import { calculateScore } from "./utils/scoring.js";
import { discoverSourceFiles } from "./utils/source-files.js";
import { isSuppressedAtLine } from "./utils/suppressions.js";
import { toRelativePath } from "./utils/path.js";

const getRuleLevel = (config: VueDoctorConfig, ruleName: string): RuleLevel | undefined => {
  const rules = config.rules ?? {};
  return rules[ruleName] ?? rules[`${PLUGIN_NAME}/${ruleName}`];
};

const resolveSeverity = (
  config: VueDoctorConfig,
  ruleName: string,
  fallback: Severity,
): Severity | "off" => getRuleLevel(config, ruleName) ?? fallback;

const ruleIsGloballyIgnored = (config: VueDoctorConfig, ruleName: string): boolean => {
  const ignoredRules = config.ignore?.rules ?? [];
  return ignoredRules.some((rule) => normalizeRuleName(rule) === ruleName || rule === "*");
};

const ruleIsIgnoredForFile = (
  config: VueDoctorConfig,
  relativePath: string,
  ruleName: string,
): boolean => {
  const overrides = config.ignore?.overrides ?? [];
  return overrides.some((override) => {
    const matchesFile = override.files.some((pattern) =>
      minimatch(relativePath, pattern, { dot: true, nocase: process.platform === "win32" }),
    );
    if (!matchesFile) return false;
    const rules = override.rules ?? ["*"];
    return rules.some((rule) => normalizeRuleName(rule) === ruleName || rule === "*");
  });
};

const toDiagnostic = (
  input: DiagnosticInput,
  context: Omit<ScanContext, "report">,
): Diagnostic | null => {
  const ruleName = normalizeRuleName(input.rule);
  const definition = ruleByName.get(ruleName);
  const defaultSeverity = input.severity ?? definition?.defaultSeverity ?? "warning";
  const severity = resolveSeverity(context.config, ruleName, defaultSeverity);

  if (severity === "off") return null;
  if (ruleIsGloballyIgnored(context.config, ruleName)) return null;
  if (ruleIsIgnoredForFile(context.config, context.relativePath, ruleName)) return null;
  if (context.config.respectInlineDisables !== false && isSuppressedAtLine(context.source, input.line, ruleName)) {
    return null;
  }

  return {
    filePath: context.filePath,
    relativePath: context.relativePath,
    plugin: PLUGIN_NAME,
    rule: ruleName,
    severity,
    category: input.category,
    message: input.message,
    help: input.help,
    line: Math.max(1, input.line),
    column: Math.max(1, input.column ?? 1),
  };
};

const createContext = (
  filePath: string,
  rootDirectory: string,
  source: string,
  config: VueDoctorConfig,
  project: ProjectInfo,
  diagnostics: Diagnostic[],
): ScanContext => {
  const relativePath = toRelativePath(filePath, rootDirectory);
  const baseContext = {
    rootDirectory,
    relativePath,
    filePath,
    source,
    config,
    project,
  };

  return {
    ...baseContext,
    report: (input) => {
      const diagnostic = toDiagnostic(input, baseContext);
      if (diagnostic) diagnostics.push(diagnostic);
    },
  };
};

const scanVueFile = (
  filePath: string,
  rootDirectory: string,
  source: string,
  config: VueDoctorConfig,
  project: ProjectInfo,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const context = createContext(filePath, rootDirectory, source, config, project, diagnostics);
  const parseResult = parse(source, { filename: filePath });

  for (const error of parseResult.errors) {
    const message = typeof error === "string" ? error : error.message;
    context.report({
      rule: "parse-sfc",
      severity: "error",
      category: "Correctness",
      message,
      help: "Fix the SFC parse error before relying on diagnostics for this file.",
      line: 1,
      column: 1,
    });
  }

  const { descriptor } = parseResult;
  scanSfcStructure(descriptor, context);

  if (descriptor.template) {
    scanTemplate(descriptor.template.content, descriptor.template.loc.start.line, context);
  }

  if (descriptor.script) {
    scanScript(descriptor.script.content, descriptor.script.loc.start.line, context);
  }

  if (descriptor.scriptSetup) {
    scanScript(descriptor.scriptSetup.content, descriptor.scriptSetup.loc.start.line, context);
  }

  return diagnostics;
};

const scanScriptFile = (
  filePath: string,
  rootDirectory: string,
  source: string,
  config: VueDoctorConfig,
  project: ProjectInfo,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const context = createContext(filePath, rootDirectory, source, config, project, diagnostics);
  scanScript(source, 0, context);
  return diagnostics;
};

const scanFile = (
  filePath: string,
  rootDirectory: string,
  config: VueDoctorConfig,
  project: ProjectInfo,
): Diagnostic[] => {
  const source = fs.readFileSync(filePath, "utf-8");
  if (path.extname(filePath) === ".vue") {
    return scanVueFile(filePath, rootDirectory, source, config, project);
  }
  return scanScriptFile(filePath, rootDirectory, source, config, project);
};

export const diagnose = async (
  directory = ".",
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const start = performance.now();
  const loaded = loadConfig(directory, options.configPath);
  const config = mergeConfig(loaded.config, options.config);
  if (options.verbose !== undefined) config.verbose = options.verbose;
  if (options.respectInlineDisables !== undefined) {
    config.respectInlineDisables = options.respectInlineDisables;
  }

  const rootDirectory = loaded.rootDirectory;
  const includePaths = options.includePaths ?? config.include ?? [];
  const project = discoverProject(rootDirectory);
  const files = discoverSourceFiles(rootDirectory, includePaths, {}, config);

  const diagnostics = files.flatMap((filePath) => scanFile(filePath, rootDirectory, config, project));
  const score = calculateScore(diagnostics, { totalSourceFiles: files.length });

  return {
    diagnostics: diagnostics.sort((left, right) => {
      if (left.relativePath !== right.relativePath) return left.relativePath.localeCompare(right.relativePath);
      if (left.line !== right.line) return left.line - right.line;
      return left.rule.localeCompare(right.rule);
    }),
    score,
    project: {
      ...project,
      sourceFileCount: files.length,
    },
    elapsedMilliseconds: performance.now() - start,
  };
};

export const summarizeDiagnostics = (diagnostics: Diagnostic[]) => ({
  errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
  warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
  affectedFileCount: new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size,
  totalDiagnosticCount: diagnostics.length,
});

export const toJsonReport = (
  directory: string,
  result: DiagnoseResult,
): JsonReport => {
  const summary = summarizeDiagnostics(result.diagnostics);
  return {
    schemaVersion: 1,
    version: VERSION,
    ok: true,
    directory: path.resolve(directory),
    project: result.project,
    diagnostics: result.diagnostics,
    summary: {
      ...summary,
      score: result.score.score,
      scoreLabel: result.score.label,
    },
    elapsedMilliseconds: result.elapsedMilliseconds,
  };
};
