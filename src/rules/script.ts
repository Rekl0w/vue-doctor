import type { DiagnosticInput, ScanContext } from "../types.js";
import { findLineMatches, getLineColumn } from "../utils/location.js";

const SECRET_VARIABLE_PATTERN = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|secret)\b/i;
const SECRET_LITERAL_PATTERNS = [
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9]{24,}\b/,
  /\b(?:xoxb|xoxp)-[A-Za-z0-9-]{24,}\b/,
];
const SECRET_FALSE_POSITIVE_SUFFIXES = new Set(["label", "title", "placeholder", "message"]);

const reportAtMatch = (
  context: ScanContext,
  source: string,
  lineOffset: number,
  match: RegExpExecArray,
  diagnostic: Omit<DiagnosticInput, "line" | "column">,
): void => {
  const location = getLineColumn(source, match.index, lineOffset);
  context.report({
    ...diagnostic,
    line: location.line,
    column: location.column,
  });
};

const reportRegexMatches = (
  context: ScanContext,
  source: string,
  lineOffset: number,
  pattern: RegExp,
  diagnostic: Omit<DiagnosticInput, "line" | "column">,
): void => {
  for (const { match } of findLineMatches(source, pattern, lineOffset)) {
    reportAtMatch(context, source, lineOffset, match, diagnostic);
  }
};

const scanSecrets = (source: string, lineOffset: number, context: ScanContext): void => {
  const assignmentPattern =
    /\b([A-Za-z_$][\w$]*(?:Key|Token|Secret|Password|PRIVATE_KEY|API_KEY|ACCESS_TOKEN)?)\b\s*[:=]\s*["'`]([^"'`]{12,})["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = assignmentPattern.exec(source)) !== null) {
    const variableName = match[1] ?? "";
    const literalValue = match[2] ?? "";
    const suffix = variableName.split(/[_-]/).pop()?.toLowerCase() ?? "";
    if (SECRET_VARIABLE_PATTERN.test(variableName) && !SECRET_FALSE_POSITIVE_SUFFIXES.has(suffix)) {
      reportAtMatch(context, source, lineOffset, match, {
        rule: "no-hardcoded-secret",
        severity: "error",
        category: "Security",
        message: `Possible hardcoded secret in "${variableName}".`,
        help: "Move secrets to server-side storage or environment variables that are never bundled into the client.",
      });
      continue;
    }
    if (SECRET_LITERAL_PATTERNS.some((pattern) => pattern.test(literalValue))) {
      reportAtMatch(context, source, lineOffset, match, {
        rule: "no-hardcoded-secret",
        severity: "error",
        category: "Security",
        message: "Hardcoded credential-like literal detected.",
        help: "Rotate the value if it is real, then load it from a server-side secret store.",
      });
    }
  }
};

const scanPropMutation = (source: string, lineOffset: number, context: ScanContext): void => {
  const mutationOperatorPattern = String.raw`(?:=(?!=|>)|\+\+|--|\+=|-=)`;

  reportRegexMatches(context, source, lineOffset, new RegExp(String.raw`\bprops\s*(?:\.\s*[$\w]+|\[\s*["'\`][^"'\`]+["'\`]\s*\])\s*${mutationOperatorPattern}`, "g"), {
    rule: "no-mutating-props",
    severity: "error",
    category: "Correctness",
    message: "Props are readonly; mutating them makes parent and child state diverge.",
    help: "Emit an event or copy the prop into local state before editing it.",
  });

  const propNames = new Set<string>();
  const propsBlock = source.match(/\bprops\s*:\s*\{([\s\S]{0,3000}?)\n\s*\}/);
  if (propsBlock?.[1]) {
    for (const match of propsBlock[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*:/g)) {
      propNames.add(match[1]!);
    }
  }

  for (const propName of propNames) {
    const escapedName = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    reportRegexMatches(context, source, lineOffset, new RegExp(`\\bthis\\.${escapedName}\\s*${mutationOperatorPattern}`, "g"), {
      rule: "no-mutating-props",
      severity: "error",
      category: "Correctness",
      message: `Prop "${propName}" is mutated directly.`,
      help: "Emit an update event or use a local ref initialized from the prop.",
    });
  }
};

const scanTooManyProps = (source: string, lineOffset: number, context: ScanContext): void => {
  const maxProps = context.config.maxProps ?? 14;
  const candidates = [
    ...source.matchAll(/\bdefineProps\s*\(\s*\{([\s\S]{0,5000}?)\n\s*\}\s*\)/g),
    ...source.matchAll(/\bprops\s*:\s*\{([\s\S]{0,5000}?)\n\s*\}/g),
  ];

  for (const match of candidates) {
    const body = match[1] ?? "";
    const count = [...body.matchAll(/(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*:/g)].length;
    if (count > maxProps) {
      reportAtMatch(context, source, lineOffset, match, {
        rule: "no-too-many-props",
        severity: "warning",
        category: "Architecture",
        message: `Component exposes ${count} props, which is a broad public API.`,
        help: "Split the component, group related options into objects, or move behavior into composables.",
      });
    }
  }
};

const scanWatchCleanup = (source: string, lineOffset: number, context: ScanContext): void => {
  const watchPattern = /\bwatch(?:Effect)?\s*\(([\s\S]{0,1200}?)\)/g;
  let match: RegExpExecArray | null;
  while ((match = watchPattern.exec(source)) !== null) {
    const body = match[1] ?? "";
    if (!/(?:async\s*\(|\bfetch\s*\(|\baxios\.|\bsetTimeout\s*\(|\bsetInterval\s*\()/.test(body)) {
      continue;
    }
    if (/\b(?:onCleanup|onWatcherCleanup|onInvalidate|AbortController|clearTimeout|clearInterval)\b/.test(body)) {
      continue;
    }
    reportAtMatch(context, source, lineOffset, match, {
      rule: "watch-requires-cleanup",
      severity: "warning",
      category: "Performance",
      message: "Async watcher has no cleanup or cancellation path.",
      help: "Use onCleanup/onWatcherCleanup with AbortController or clear pending timers between runs.",
    });
  }
};

const scanVue2DeprecatedApi = (source: string, lineOffset: number, context: ScanContext): void => {
  if (!context.project.vueVersion || !/[\^~>=<\s]*3/.test(context.project.vueVersion)) return;
  const patterns = [
    { pattern: /\bthis\.\$listeners\b/g, label: "this.$listeners" },
    { pattern: /\bbeforeDestroy\s*\(/g, label: "beforeDestroy" },
    { pattern: /\bdestroyed\s*\(/g, label: "destroyed" },
  ];

  for (const { pattern, label } of patterns) {
    reportRegexMatches(context, source, lineOffset, pattern, {
      rule: "no-vue2-deprecated-api",
      severity: "warning",
      category: "Correctness",
      message: `${label} is a Vue 2 API and is not compatible with Vue 3.`,
      help: "Use the Vue 3 migration equivalent before upgrading or publishing reusable components.",
    });
  }
};

const scanBundleSizeImports = (source: string, lineOffset: number, context: ScanContext): void => {
  reportRegexMatches(context, source, lineOffset, /\bimport\s+(?:\*\s+as\s+\w+|\w+)\s+from\s+["']lodash["']/g, {
    rule: "no-full-lodash-import",
    severity: "warning",
    category: "Bundle Size",
    message: "Full lodash import pulls a large utility bundle into client code.",
    help: "Import the specific function path, use lodash-es tree-shaken imports, or prefer native JavaScript.",
  });
  reportRegexMatches(context, source, lineOffset, /\brequire\s*\(\s*["']lodash["']\s*\)/g, {
    rule: "no-full-lodash-import",
    severity: "warning",
    category: "Bundle Size",
    message: "Requiring lodash pulls a large utility bundle into client code.",
    help: "Require a specific lodash function path or prefer native JavaScript.",
  });
  reportRegexMatches(context, source, lineOffset, /\bimport\s+[\s\S]{0,80}\s+from\s+["']moment["']/g, {
    rule: "no-moment",
    severity: "warning",
    category: "Bundle Size",
    message: "moment is heavy for browser bundles and is rarely tree-shaken.",
    help: "Prefer Intl APIs, dayjs, date-fns, or a route-level dynamic import if moment is unavoidable.",
  });
  reportRegexMatches(context, source, lineOffset, /\brequire\s*\(\s*["']moment["']\s*\)/g, {
    rule: "no-moment",
    severity: "warning",
    category: "Bundle Size",
    message: "moment is heavy for browser bundles and is rarely tree-shaken.",
    help: "Prefer Intl APIs, dayjs, date-fns, or a route-level dynamic import if moment is unavoidable.",
  });

  const heavyPackages = "(?:monaco-editor|echarts|chart\\.js|three|mapbox-gl|pdfjs-dist)";
  reportRegexMatches(context, source, lineOffset, new RegExp(`\\bimport\\s+[\\s\\S]{0,120}\\s+from\\s+["']${heavyPackages}["']`, "g"), {
    rule: "prefer-dynamic-import",
    severity: "warning",
    category: "Bundle Size",
    message: "Heavy browser-only dependency is imported eagerly.",
    help: "Use dynamic import() inside the route, component, or interaction that needs this library.",
  });
};

export const scanScript = (source: string, lineOffset: number, context: ScanContext): void => {
  reportRegexMatches(context, source, lineOffset, /\beval\s*\(/g, {
    rule: "no-eval",
    severity: "error",
    category: "Security",
    message: "eval() executes arbitrary code.",
    help: "Use data structures, explicit dispatch tables, or safe parsers instead.",
  });
  reportRegexMatches(context, source, lineOffset, /\bnew\s+Function\s*\(/g, {
    rule: "no-eval",
    severity: "error",
    category: "Security",
    message: "new Function() executes dynamically generated code.",
    help: "Avoid dynamic code execution in browser bundles.",
  });
  reportRegexMatches(context, source, lineOffset, /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g, {
    rule: "no-eval",
    severity: "error",
    category: "Security",
    message: "String timers execute code dynamically.",
    help: "Pass a function to setTimeout or setInterval.",
  });

  scanSecrets(source, lineOffset, context);
  scanPropMutation(source, lineOffset, context);
  scanTooManyProps(source, lineOffset, context);
  scanWatchCleanup(source, lineOffset, context);
  scanVue2DeprecatedApi(source, lineOffset, context);
  scanBundleSizeImports(source, lineOffset, context);

  reportRegexMatches(context, source, lineOffset, /\bdeep\s*:\s*true\b/g, {
    rule: "no-deep-watch",
    severity: "warning",
    category: "Performance",
    message: "deep: true makes Vue traverse the whole watched object graph.",
    help: "Watch a narrower source, use a computed projection, or document why deep traversal is bounded.",
  });
};
