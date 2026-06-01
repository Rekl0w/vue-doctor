import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import pc from "picocolors";
import { DEFAULT_FAIL_ON, VERSION } from "./constants.js";
import {
  diagnose,
  summarizeDiagnostics,
  toJsonReport,
  toJsonReportFromScans,
} from "./scanner.js";
import { toMarkdownReport, toSarifReport } from "./reporters.js";
import type {
  Diagnostic,
  DiffInfo,
  DiagnoseResult,
  FailOnLevel,
  JsonReport,
  JsonReportMode,
  ScoreResult,
  VueDoctorConfig,
  VueDoctorPreset,
} from "./types.js";
import { getDiffInfo, getStagedSourceFiles, filterSourceFiles } from "./utils/git.js";
import { loadConfig } from "./utils/config.js";
import { toRelativePath } from "./utils/path.js";
import { runInstallSkill } from "./utils/install-skill.js";
import { selectProjectDirectories } from "./utils/workspaces.js";
import { calculateScore } from "./utils/scoring.js";
import { filterDiagnosticsByBaseline, readBaselineKeys, writeBaseline } from "./utils/baseline.js";

interface CliFlags {
  verbose?: boolean;
  json?: boolean;
  markdown?: boolean;
  sarif?: boolean;
  jsonCompact?: boolean;
  score?: boolean;
  annotations?: boolean;
  prComment?: boolean;
  yes?: boolean;
  full?: boolean;
  staged?: boolean;
  offline?: boolean;
  diff?: boolean | string;
  project?: string;
  failOn?: string;
  preset?: string;
  baseline?: string;
  updateBaseline?: string;
  config?: string;
  include?: string[];
  explain?: string;
  why?: string;
  respectInlineDisables?: boolean;
}

interface InstallFlags {
  yes?: boolean | undefined;
  dryRun?: boolean | undefined;
  cwd?: string | undefined;
}

interface CompletedScan {
  directory: string;
  result: DiagnoseResult;
}

const VALID_FAIL_ON_LEVELS = new Set<FailOnLevel>(["error", "warning", "none"]);
const VALID_PRESETS = new Set<VueDoctorPreset>(["recommended", "strict", "design"]);
const MAX_RULES_PER_CATEGORY = 3;
const SCORE_BAR_WIDTH = 44;
const SYMBOLS = {
  ok: "OK",
  error: "x",
  warning: "!",
  arrow: "->",
};

const parseInclude = (value: string, previous: string[] = []): string[] => [
  ...previous,
  ...value.split(",").map((entry) => entry.trim()).filter(Boolean),
];

const colorByScore = (score: ScoreResult): ((text: string) => string) => {
  if (score.score >= 75) return pc.green;
  if (score.score >= 50) return pc.yellow;
  return pc.red;
};

const shouldFail = (diagnostics: Diagnostic[], failOn: FailOnLevel): boolean => {
  if (failOn === "none") return false;
  if (failOn === "warning") return diagnostics.length > 0;
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
};

const resolveFailOn = (value: string | undefined): FailOnLevel =>
  VALID_FAIL_ON_LEVELS.has(value as FailOnLevel) ? (value as FailOnLevel) : DEFAULT_FAIL_ON;

const resolvePreset = (value: string | undefined): VueDoctorPreset | undefined => {
  if (value === undefined) return undefined;
  if (VALID_PRESETS.has(value as VueDoctorPreset)) return value as VueDoctorPreset;
  throw new Error(`Preset "${value}" is not supported. Use recommended, strict, or design.`);
};

const resolveOptionalPath = (rootDirectory: string, value: string | undefined): string | undefined =>
  value ? path.resolve(rootDirectory, value) : undefined;

const filterScanByBaseline = (scan: CompletedScan, baselineKeys: Set<string>): CompletedScan => {
  const diagnostics = filterDiagnosticsByBaseline(scan.result.diagnostics, baselineKeys);
  return {
    directory: scan.directory,
    result: {
      ...scan.result,
      diagnostics,
      score: calculateScore(diagnostics, {
        totalSourceFiles: scan.result.project.sourceFileCount,
      }),
    },
  };
};

const printScore = (score: ScoreResult): void => {
  const color = colorByScore(score);
  const filled = Math.round((score.score / 100) * SCORE_BAR_WIDTH);
  const bar = `${"#".repeat(filled)}${"-".repeat(SCORE_BAR_WIDTH - filled)}`;
  const face = score.score >= 75 ? "^_^" : score.score >= 50 ? "-_-" : "x_x";
  const scoreLine = `${color(`${score.score} / 100`)} ${pc.dim(score.label)}`;

  console.log(`  +-------+  ${scoreLine}`);
  console.log(`  | ${face.padEnd(5, " ")} |  ${color(bar)}`);
  console.log(`  +-------+  ${pc.bold("Vue Doctor")}`);
};

const groupDiagnostics = (diagnostics: Diagnostic[]): Map<string, Diagnostic[]> => {
  const grouped = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const list = grouped.get(diagnostic.category) ?? [];
    list.push(diagnostic);
    grouped.set(diagnostic.category, list);
  }
  return grouped;
};

const groupByRule = (diagnostics: Diagnostic[]): Map<string, Diagnostic[]> => {
  const grouped = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const list = grouped.get(diagnostic.rule) ?? [];
    list.push(diagnostic);
    grouped.set(diagnostic.rule, list);
  }
  return grouped;
};

const formatSeverity = (diagnostic: Diagnostic): string =>
  diagnostic.severity === "error" ? pc.red("error") : pc.yellow("warn");

const formatCompactSeverity = (diagnostics: Diagnostic[]): string =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? pc.red(SYMBOLS.error)
    : pc.yellow(SYMBOLS.warning);

const formatIssueCount = (count: number): string => `${count} ${count === 1 ? "issue" : "issues"}`;

const formatSourceFileCount = (count: number): string =>
  `${count} source ${count === 1 ? "file" : "files"}`;

const RULE_TITLES: Record<string, string> = {
  "no-v-html": "v-html",
  "no-target-blank-without-rel": "Target blank without rel",
  "no-eval": "Dynamic code execution",
  "no-hardcoded-secret": "Hardcoded secret",
  "no-public-runtime-secret": "Public runtime secret",
  "require-v-for-key": "Missing v-for key",
  "no-index-key": "Index key",
  "no-v-if-with-v-for": "v-if with v-for",
  "no-template-side-effects": "Template side effect",
  "no-mutating-props": "Mutating props",
  "no-vue2-deprecated-api": "Vue 2 deprecated API",
  "no-ssr-browser-global": "SSR browser global",
  "no-hydration-unstable-template": "Hydration-unstable template",
  "no-expensive-template-expression": "Expensive template expression",
  "no-deep-watch": "Deep watch",
  "watch-requires-cleanup": "Watcher needs cleanup",
  "no-transition-all": "Transition all",
  "no-permanent-will-change": "Permanent will-change",
  "require-img-alt": "Image alt",
  "require-button-name": "Button accessible name",
  "no-autofocus": "Autofocus",
  "no-disabled-zoom": "Disabled zoom",
  "no-large-component": "Large component",
  "no-too-many-props": "Too many props",
  "prefer-scoped-style": "Scoped style",
  "no-full-lodash-import": "Full lodash import",
  "no-moment": "Moment import",
  "prefer-dynamic-import": "Heavy static import",
  "no-outline-none": "Removed focus outline",
  "no-tiny-text": "Tiny text",
  "no-wide-letter-spacing": "Letter spacing",
  "no-z-index-9999": "Magic z-index",
  "no-pure-black-background": "Pure black background",
  "no-gradient-text": "Gradient text",
};

const toRuleTitle = (ruleName: string): string => {
  const knownTitle = RULE_TITLES[ruleName];
  if (knownTitle) return knownTitle;

  const readable = ruleName
    .replace(/^(no|prefer|require)-/, "")
    .replaceAll("-", " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
};

const sortDiagnosticsByImportance = (diagnostics: Diagnostic[]): Diagnostic[] =>
  [...diagnostics].sort((left, right) => {
    const severityDelta =
      (left.severity === "error" ? 0 : 1) - (right.severity === "error" ? 0 : 1);
    if (severityDelta !== 0) return severityDelta;
    if (left.relativePath !== right.relativePath) return left.relativePath.localeCompare(right.relativePath);
    return left.line - right.line;
  });

const sortGroupsByImportance = (groups: Array<[string, Diagnostic[]]>): Array<[string, Diagnostic[]]> =>
  [...groups].sort(([, leftDiagnostics], [, rightDiagnostics]) => {
    const leftSeverity = leftDiagnostics.some((diagnostic) => diagnostic.severity === "error") ? 0 : 1;
    const rightSeverity = rightDiagnostics.some((diagnostic) => diagnostic.severity === "error") ? 0 : 1;
    if (leftSeverity !== rightSeverity) return leftSeverity - rightSeverity;
    if (leftDiagnostics.length !== rightDiagnostics.length) return rightDiagnostics.length - leftDiagnostics.length;
    return leftDiagnostics[0]!.rule.localeCompare(rightDiagnostics[0]!.rule);
  });

const wrapText = (text: string, indent: string, width = 88): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (indent.length + next.length > width && current.length > 0) {
      lines.push(`${indent}${current}`);
      current = word;
      continue;
    }
    current = next;
  }

  if (current.length > 0) lines.push(`${indent}${current}`);
  return lines.length > 0 ? lines : [indent];
};

const printWrappedDim = (text: string, indent: string): void => {
  for (const line of wrapText(text, indent)) {
    console.log(pc.dim(line));
  }
};

const printCompactRuleGroup = (rule: string, diagnostics: Diagnostic[]): void => {
  const sorted = sortDiagnosticsByImportance(diagnostics);
  const first = sorted[0]!;
  const countBadge = diagnostics.length > 1 ? ` x${diagnostics.length}` : "";
  const location = `${first.relativePath}:${first.line}`;

  console.log(`  ${formatCompactSeverity(diagnostics)} ${pc.bold(toRuleTitle(rule))}${pc.dim(countBadge)}`);
  printWrappedDim(first.message, "    ");
  if (first.help) {
    printWrappedDim(first.help, "    ");
  }
  console.log(pc.dim(`    ${location}`));
};

const printCompactDiagnostics = (diagnostics: Diagnostic[]): number => {
  if (diagnostics.length === 0) {
    console.log(pc.green("No Vue Doctor diagnostics found."));
    return 0;
  }

  let hiddenCount = 0;
  const categoryGroups = sortGroupsByImportance([...groupDiagnostics(diagnostics).entries()]);
  for (const [category, categoryDiagnostics] of categoryGroups) {
    console.log("");
    console.log(`${pc.bold(category)} ${pc.dim(formatIssueCount(categoryDiagnostics.length))}`);

    const ruleGroups = sortGroupsByImportance([...groupByRule(categoryDiagnostics).entries()]);
    const visibleRuleGroups = ruleGroups.slice(0, MAX_RULES_PER_CATEGORY);
    const hiddenRuleGroups = ruleGroups.slice(MAX_RULES_PER_CATEGORY);

    for (const [rule, ruleDiagnostics] of visibleRuleGroups) {
      printCompactRuleGroup(rule, ruleDiagnostics);
    }

    hiddenCount += hiddenRuleGroups.reduce((total, [, ruleDiagnostics]) => total + ruleDiagnostics.length, 0);
  }

  return hiddenCount;
};

const printVerboseDiagnostics = (diagnostics: Diagnostic[]): void => {
  if (diagnostics.length === 0) {
    console.log(pc.green("No Vue Doctor diagnostics found."));
    return;
  }

  const grouped = groupDiagnostics(diagnostics);
  for (const [category, categoryDiagnostics] of grouped) {
    console.log("");
    console.log(pc.bold(category));
    for (const diagnostic of categoryDiagnostics) {
      const location = `${diagnostic.relativePath}:${diagnostic.line}:${diagnostic.column}`;
      console.log(`  ${formatSeverity(diagnostic)} ${pc.bold(`vue-doctor/${diagnostic.rule}`)} ${pc.dim(location)}`);
      console.log(`    ${diagnostic.message}`);
      console.log(pc.dim(`    ${diagnostic.help}`));
    }
  }
};

const printDiagnostics = (diagnostics: Diagnostic[], verbose: boolean): void => {
  if (verbose) {
    printVerboseDiagnostics(diagnostics);
    return;
  }

  const hiddenCount = printCompactDiagnostics(diagnostics);
  if (hiddenCount > 0) {
    console.log("");
    console.log(pc.dim(`  ${SYMBOLS.warning} ${hiddenCount} more diagnostics`));
    console.log(pc.dim(`    ${SYMBOLS.arrow} Run \`npx -y @rekl0w/vue-doctor . --verbose\` to get all details.`));
  }
};

const encodeAnnotationValue = (value: string): string =>
  value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A").replaceAll(",", "%2C");

const printAnnotations = (diagnostics: Diagnostic[]): void => {
  for (const diagnostic of diagnostics) {
    const level = diagnostic.severity === "error" ? "error" : "warning";
    const file = encodeAnnotationValue(diagnostic.relativePath);
    const title = encodeAnnotationValue(`vue-doctor/${diagnostic.rule}`);
    const message = encodeAnnotationValue(diagnostic.message);
    console.log(`::${level} file=${file},line=${diagnostic.line},col=${diagnostic.column},title=${title}::${message}`);
  }
};

const writeFullReport = (directory: string, report: JsonReport): string => {
  const outputDirectory = join(tmpdir(), `vue-doctor-${randomUUID()}`);
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "report.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
};

const formatElapsed = (milliseconds: number): string =>
  milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${Math.round(milliseconds)}ms`;

const formatFrameworkName = (framework: DiagnoseResult["project"]["framework"]): string => {
  const names: Record<DiagnoseResult["project"]["framework"], string> = {
    nuxt: "Nuxt",
    vite: "Vite",
    "vue-cli": "Vue CLI",
    quasar: "Quasar",
    vitepress: "VitePress",
    vuepress: "VuePress",
    unknown: "Vue",
  };
  return names[framework];
};

const printRunHeader = (result: DiagnoseResult): void => {
  const framework = formatFrameworkName(result.project.framework);
  console.log(`vue-doctor v${VERSION}`);
  console.log("");
  console.log(`Scanning ${result.project.rootDirectory}...`);
  console.log("");
  console.log(`${pc.green(SYMBOLS.ok)} Detecting framework. Found ${framework}.`);
  console.log(
    `${pc.green(SYMBOLS.ok)} Detecting Vue version. ${
      result.project.vueVersion ? `Found Vue ${result.project.vueVersion}.` : "No Vue dependency found."
    }`,
  );
  console.log(
    `${pc.green(SYMBOLS.ok)} Detecting language. Found ${
      result.project.hasTypeScript ? "TypeScript" : "JavaScript"
    }.`,
  );
  if (result.project.hasPinia) {
    console.log(`${pc.green(SYMBOLS.ok)} Detecting Pinia. Found.`);
  }
  if (result.project.hasVueRouter) {
    console.log(`${pc.green(SYMBOLS.ok)} Detecting Vue Router. Found.`);
  }
  console.log(`${pc.green(SYMBOLS.ok)} Found ${formatSourceFileCount(result.project.sourceFileCount)}.`);
  console.log("");
  console.log(`${pc.green(SYMBOLS.ok)} Running Vue checks.`);
};

const printRunFooter = (
  result: DiagnoseResult,
  fullDiagnosticsPath: string | null,
): void => {
  const summary = summarizeDiagnostics(result.diagnostics);
  console.log("");
  printScore(result.score);
  console.log("");
  console.log(
    pc.dim(
      `${formatIssueCount(summary.totalDiagnosticCount)} across ${summary.affectedFileCount}/${result.project.sourceFileCount} files in ${formatElapsed(result.elapsedMilliseconds)}`,
    ),
  );
  if (fullDiagnosticsPath) {
    console.log(pc.dim(`Full diagnostics written to ${fullDiagnosticsPath}`));
  }
  if (summary.totalDiagnosticCount > 0) {
    console.log(pc.dim(`${SYMBOLS.arrow} Use --verbose for every diagnostic, --json for automation, or --score for CI gates.`));
  }
};

const coerceDiffValue = (value: unknown): boolean | string | undefined => {
  if (value === undefined) return undefined;
  if (value === true || value === false) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.length > 0 ? trimmed : true;
};

const resolveDiffValue = (flags: CliFlags, configDiff: boolean | string | undefined): boolean | string | undefined => {
  if (flags.full) return false;
  return coerceDiffValue(flags.diff ?? configDiff);
};

const getWorstScore = (scans: CompletedScan[]): ScoreResult => {
  if (scans.length === 0) return { score: 100, label: "Great" };
  return scans
    .map((scan) => scan.result.score)
    .sort((left, right) => left.score - right.score)[0]!;
};

const getAllDiagnostics = (scans: CompletedScan[]): Diagnostic[] =>
  scans.flatMap((scan) => scan.result.diagnostics);

const resolveRespectInlineDisables = (flags: CliFlags): boolean | undefined =>
  typeof flags.respectInlineDisables === "boolean" ? flags.respectInlineDisables : undefined;

const parseExplainTarget = (value: string): { file: string; line: number } => {
  const match = value.match(/^(.*):(\d+)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error("Expected --explain value to look like src/App.vue:42.");
  }
  return { file: match[1], line: Number(match[2]) };
};

const runExplain = async (
  rootDirectory: string,
  flags: CliFlags,
  explainValue: string,
  configOverride?: VueDoctorConfig,
): Promise<void> => {
  const target = parseExplainTarget(explainValue);
  const activeResult = await diagnose(rootDirectory, {
    configPath: flags.config,
    config: configOverride,
    includePaths: [target.file],
    respectInlineDisables: resolveRespectInlineDisables(flags),
  });
  const auditResult = await diagnose(rootDirectory, {
    configPath: flags.config,
    config: configOverride,
    includePaths: [target.file],
    respectInlineDisables: false,
  });

  const isSameDiagnostic = (left: Diagnostic, right: Diagnostic): boolean =>
    left.rule === right.rule && left.relativePath === right.relativePath && left.line === right.line && left.column === right.column;
  const nearTarget = (diagnostic: Diagnostic): boolean =>
    diagnostic.relativePath === toRelativePath(path.resolve(rootDirectory, target.file), rootDirectory) &&
    Math.abs(diagnostic.line - target.line) <= 1;
  const active = activeResult.diagnostics.filter(nearTarget);
  const suppressed = auditResult.diagnostics
    .filter(nearTarget)
    .filter((diagnostic) => !activeResult.diagnostics.some((activeDiagnostic) => isSameDiagnostic(activeDiagnostic, diagnostic)));

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          version: VERSION,
          ok: true,
          explain: {
            file: target.file,
            line: target.line,
            diagnostics: active,
            suppressed,
          },
        },
        null,
        flags.jsonCompact ? 0 : 2,
      )}\n`,
    );
    return;
  }

  console.log(`Vue Doctor explain: ${target.file}:${target.line}`);
  if (active.length === 0 && suppressed.length === 0) {
    console.log(pc.green("No Vue Doctor diagnostics found at this line."));
    return;
  }

  if (active.length > 0) {
    console.log("");
    console.log(pc.bold("Active diagnostics"));
    printVerboseDiagnostics(active);
  }
  if (suppressed.length > 0) {
    console.log("");
    console.log(pc.bold("Suppressed diagnostics"));
    printVerboseDiagnostics(suppressed);
  }
};

const runInspect = async (directory: string, flags: CliFlags): Promise<void> => {
  const requestedDirectory = path.resolve(directory);
  const start = performance.now();
  const loaded = loadConfig(requestedDirectory, flags.config);
  const rootDirectory = loaded.rootDirectory;
  const failOn = resolveFailOn(flags.failOn ?? loaded.config.failOn);
  const preset = resolvePreset(flags.preset ?? loaded.config.preset);
  const configOverride: VueDoctorConfig | undefined = preset ? { preset } : undefined;
  const baselinePath = resolveOptionalPath(rootDirectory, flags.baseline ?? loaded.config.baseline);
  const updateBaselinePath = resolveOptionalPath(rootDirectory, flags.updateBaseline);
  const explainValue = flags.explain ?? flags.why;

  if (explainValue) {
    await runExplain(rootDirectory, flags, explainValue, configOverride);
    return;
  }

  const quiet = Boolean(flags.json || flags.markdown || flags.sarif || flags.score || flags.annotations);
  const projectDirectories = selectProjectDirectories(rootDirectory, flags.project, Boolean(flags.yes));
  const diffValue = resolveDiffValue(flags, loaded.config.diff);
  const mode: JsonReportMode = flags.staged ? "staged" : diffValue !== undefined && diffValue !== false ? "diff" : "full";
  const explicitBase = typeof diffValue === "string" ? diffValue : undefined;
  let scans: CompletedScan[] = [];
  let reportDiff: DiffInfo | null = null;

  if (flags.offline && !quiet) {
    console.log(pc.dim("Offline mode enabled. Vue Doctor already scores locally, so no network call is made."));
    console.log("");
  }

  for (const projectDirectory of projectDirectories) {
    let includePaths = flags.include && flags.include.length > 0 ? flags.include : undefined;

    if (flags.staged) {
      const stagedFiles = getStagedSourceFiles(projectDirectory);
      if (stagedFiles.length === 0) {
        continue;
      }
      includePaths = stagedFiles;
    } else if (mode === "diff") {
      const diffInfo = getDiffInfo(projectDirectory, explicitBase);
      if (projectDirectory === projectDirectories[0]) reportDiff = diffInfo;
      if (diffInfo) {
        const changedSourceFiles = filterSourceFiles(diffInfo.changedFiles);
        if (changedSourceFiles.length === 0) {
          if (!quiet) console.log(pc.dim(`No changed source files in ${projectDirectory}, skipping.`));
          continue;
        }
        includePaths = changedSourceFiles;
        if (!quiet) {
          if (diffInfo.isCurrentChanges) {
            console.log("Scanning uncommitted changes.");
          } else {
            console.log(`Scanning changes: ${diffInfo.currentBranch} -> ${diffInfo.baseBranch}`);
          }
          console.log("");
        }
      } else if (!quiet) {
        console.log(pc.dim(`Cannot detect diff for ${projectDirectory}; scanning all files.`));
        console.log("");
      }
    }

    const result = await diagnose(projectDirectory, {
      verbose: flags.verbose,
      configPath: flags.config,
      config: configOverride,
      includePaths,
      respectInlineDisables: resolveRespectInlineDisables(flags),
    });
    scans.push({ directory: projectDirectory, result });
  }

  const rawDiagnostics = getAllDiagnostics(scans);
  if (updateBaselinePath) {
    writeBaseline(updateBaselinePath, rawDiagnostics);
    if (!quiet) {
      console.log(pc.dim(`Baseline written to ${updateBaselinePath}`));
      console.log("");
    }
  }

  if (baselinePath) {
    const baselineKeys = readBaselineKeys(baselinePath);
    scans = scans.map((scan) => filterScanByBaseline(scan, baselineKeys));
  }

  const report = toJsonReportFromScans(rootDirectory, scans, {
    mode,
    diff: mode === "diff" ? reportDiff : null,
    elapsedMilliseconds: performance.now() - start,
  });
  const diagnostics = getAllDiagnostics(scans);

  if (flags.staged && scans.length === 0) {
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(report, null, flags.jsonCompact ? 0 : 2)}\n`);
    } else if (flags.sarif) {
      process.stdout.write(`${JSON.stringify(toSarifReport(report), null, flags.jsonCompact ? 0 : 2)}\n`);
    } else if (flags.markdown) {
      process.stdout.write(toMarkdownReport(report));
    } else if (!flags.score && !flags.annotations) {
      console.log(pc.dim("No staged source files found."));
    }
    return;
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, flags.jsonCompact ? 0 : 2)}\n`);
  } else if (flags.sarif) {
    process.stdout.write(`${JSON.stringify(toSarifReport(report), null, flags.jsonCompact ? 0 : 2)}\n`);
  } else if (flags.markdown) {
    process.stdout.write(toMarkdownReport(report));
  } else if (flags.score) {
    process.stdout.write(`${getWorstScore(scans).score}\n`);
  } else if (flags.annotations) {
    printAnnotations(diagnostics);
  } else if (scans.length === 0) {
    console.log(pc.green("No Vue source files matched this scan."));
    printScore({ score: 100, label: "Great" });
  } else {
    const fullDiagnosticsPath =
      flags.verbose || diagnostics.length === 0 ? null : writeFullReport(rootDirectory, report);
    for (const [index, scan] of scans.entries()) {
      if (scans.length > 1) {
        console.log(pc.bold(`Project ${index + 1}/${scans.length}: ${scan.result.project.projectName}`));
        console.log("");
      }
      printRunHeader(scan.result);
      printDiagnostics(scan.result.diagnostics, Boolean(flags.verbose || flags.prComment));
      printRunFooter(scan.result, scans.length === 1 ? fullDiagnosticsPath : null);
      if (index < scans.length - 1) console.log("");
    }
    if (scans.length > 1 && fullDiagnosticsPath) {
      console.log("");
      console.log(pc.dim(`Full diagnostics written to ${fullDiagnosticsPath}`));
    }
  }

  process.exitCode = shouldFail(diagnostics, failOn) ? 1 : 0;
};

const runInstall = async (flags: InstallFlags): Promise<void> => {
  console.log(`vue-doctor v${VERSION}`);
  console.log("");
  await runInstallSkill({
    yes: flags.yes,
    dryRun: flags.dryRun,
    cwd: flags.cwd,
  });
};

export const runCli = async (argv = process.argv): Promise<void> => {
  const program = new Command();
  program
    .name("vue-doctor")
    .description("Scan Vue codebases for security, performance, correctness, accessibility, bundle-size, design, and architecture issues.")
    .argument("[directory]", "project directory to scan", ".")
    .version(VERSION, "-v, --version")
    .option("--verbose", "show every diagnostic", false)
    .option("--json", "output a single structured JSON report", false)
    .option("--markdown", "output a Markdown report", false)
    .option("--sarif", "output a SARIF 2.1.0 report", false)
    .option("--json-compact", "with --json, emit compact JSON", false)
    .option("--score", "output only the score", false)
    .option("--annotations", "output GitHub Actions annotations", false)
    .option("--pr-comment", "tune terminal output for sticky PR comments", false)
    .option("-y, --yes", "skip prompts and scan all detected workspace projects", false)
    .option("--full", "force a full scan and ignore config diff / --diff", false)
    .option("--project <name>", "workspace project(s) to scan; repeat by comma-separating names")
    .option("--diff [base]", "scan files changed vs base branch; pass false to disable")
    .option("--staged", "scan staged git files", false)
    .option("--offline", "accepted for React Doctor parity; Vue Doctor always scores locally", false)
    .option("--fail-on <level>", "exit with error on diagnostics: error, warning, none", DEFAULT_FAIL_ON)
    .option("--preset <name>", "rule preset: recommended, strict, design")
    .option("--baseline <path>", "ignore diagnostics already present in a baseline file")
    .option("--update-baseline <path>", "write the current diagnostics to a baseline file")
    .option("--config <path>", "path to vue-doctor.config.json")
    .option("--include <path>", "file or directory to scan; can be repeated or comma-separated", parseInclude, [])
    .option("--explain <file:line>", "show diagnostics and suppressed diagnostics near a specific location")
    .option("--why <file:line>", "alias for --explain")
    .option("--respect-inline-disables", "respect inline vue-doctor/eslint/oxlint disable comments")
    .option("--no-respect-inline-disables", "audit mode: ignore inline disable comments")
    .allowExcessArguments(false)
    .action(runInspect);

  program
    .command("install")
    .alias("setup")
    .description("Install the vue-doctor skill into detected coding agents")
    .option("-y, --yes", "skip prompts and install for all detected agents", false)
    .option("--dry-run", "show what would be installed without writing files", false)
    .option("-c, --cwd <cwd>", "working directory", process.cwd())
    .action(runInstall);

  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
  });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    const flags = program.opts<CliFlags>();
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            version: VERSION,
            ok: false,
            directory: path.resolve(program.args[0] ?? "."),
            error: error instanceof Error ? { name: error.name, message: error.message } : { name: "Error", message: String(error) },
          },
          null,
          flags.jsonCompact ? 0 : 2,
        )}\n`,
      );
    } else {
      console.error(pc.red("Vue Doctor failed"));
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
};

void runCli();
