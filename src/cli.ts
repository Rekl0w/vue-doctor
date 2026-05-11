import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import pc from "picocolors";
import { DEFAULT_FAIL_ON, VERSION } from "./constants.js";
import { diagnose, summarizeDiagnostics, toJsonReport } from "./scanner.js";
import type { Diagnostic, DiagnoseResult, FailOnLevel, ScoreResult } from "./types.js";

interface CliFlags {
  verbose?: boolean;
  json?: boolean;
  score?: boolean;
  annotations?: boolean;
  failOn?: string;
  config?: string;
  include?: string[];
}

const VALID_FAIL_ON_LEVELS = new Set<FailOnLevel>(["error", "warning", "none"]);
const MAX_RULES_PER_CATEGORY = 3;
const SCORE_BAR_WIDTH = 44;
const SYMBOLS = {
  ok: "✔",
  error: "✗",
  warning: "⚠",
  arrow: "→",
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

const printScore = (score: ScoreResult): void => {
  const color = colorByScore(score);
  const filled = Math.round((score.score / 100) * SCORE_BAR_WIDTH);
  const bar = `${"█".repeat(filled)}${"░".repeat(SCORE_BAR_WIDTH - filled)}`;
  const face = score.score >= 75 ? "•‿•" : score.score >= 50 ? "• - •" : "•︵•";
  const scoreLine = `${color(`${score.score} / 100`)} ${pc.dim(score.label)}`;

  console.log(`  ┌───────┐  ${scoreLine}`);
  console.log(`  │ ${face.padEnd(5, " ")} │  ${color(bar)}`);
  console.log(`  └───────┘  ${pc.bold("Vue Doctor")}`);
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
  "require-v-for-key": "Missing v-for key",
  "no-index-key": "Index key",
  "no-v-if-with-v-for": "v-if with v-for",
  "no-template-side-effects": "Template side effect",
  "no-mutating-props": "Mutating props",
  "no-vue2-deprecated-api": "Vue 2 deprecated API",
  "no-expensive-template-expression": "Expensive template expression",
  "no-deep-watch": "Deep watch",
  "watch-requires-cleanup": "Watcher needs cleanup",
  "require-img-alt": "Image alt",
  "require-button-name": "Button accessible name",
  "no-autofocus": "Autofocus",
  "no-large-component": "Large component",
  "no-too-many-props": "Too many props",
  "prefer-scoped-style": "Scoped style",
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

const printAnnotations = (diagnostics: Diagnostic[]): void => {
  for (const diagnostic of diagnostics) {
    const level = diagnostic.severity === "error" ? "error" : "warning";
    const file = diagnostic.relativePath.replaceAll(",", "%2C").replaceAll("\n", "%0A");
    const title = `vue-doctor/${diagnostic.rule}`.replaceAll(",", "%2C").replaceAll("\n", "%0A");
    const message = diagnostic.message.replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    console.log(`::${level} file=${file},line=${diagnostic.line},title=${title}::${message}`);
  }
};

const writeFullDiagnostics = (directory: string, result: DiagnoseResult): string => {
  const outputDirectory = join(tmpdir(), `vue-doctor-${randomUUID()}`);
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "report.json");
  writeFileSync(outputPath, `${JSON.stringify(toJsonReport(directory, result), null, 2)}\n`);
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

export const runCli = async (argv = process.argv): Promise<void> => {
  const program = new Command();
  program
    .name("vue-doctor")
    .description("Scan Vue codebases for security, performance, correctness, accessibility, and architecture issues.")
    .argument("[directory]", "project directory to scan", ".")
    .version(VERSION, "-v, --version")
    .option("--verbose", "show every diagnostic", false)
    .option("--json", "output a single structured JSON report", false)
    .option("--score", "output only the score", false)
    .option("--annotations", "output GitHub Actions annotations", false)
    .option("--fail-on <level>", "exit with error on diagnostics: error, warning, none", DEFAULT_FAIL_ON)
    .option("--config <path>", "path to vue-doctor.config.json")
    .option("--include <path>", "file or directory to scan; can be repeated or comma-separated", parseInclude, [])
    .allowExcessArguments(false);

  program.parse(argv);
  const directory = program.args[0] ?? ".";
  const flags = program.opts<CliFlags>();
  const failOn = VALID_FAIL_ON_LEVELS.has(flags.failOn as FailOnLevel)
    ? (flags.failOn as FailOnLevel)
    : DEFAULT_FAIL_ON;

  try {
    const result = await diagnose(directory, {
      verbose: flags.verbose,
      configPath: flags.config,
      includePaths: flags.include,
    });

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(toJsonReport(directory, result), null, 2)}\n`);
    } else if (flags.score) {
      process.stdout.write(`${result.score.score}\n`);
    } else if (flags.annotations) {
      printAnnotations(result.diagnostics);
    } else {
      const fullDiagnosticsPath =
        flags.verbose || result.diagnostics.length === 0 ? null : writeFullDiagnostics(directory, result);
      printRunHeader(result);
      printDiagnostics(result.diagnostics, Boolean(flags.verbose));
      printRunFooter(result, fullDiagnosticsPath);
    }

    process.exitCode = shouldFail(result.diagnostics, failOn) ? 1 : 0;
  } catch (error) {
    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            version: VERSION,
            ok: false,
            directory,
            error: error instanceof Error ? { name: error.name, message: error.message } : { name: "Error", message: String(error) },
          },
          null,
          2,
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
