import type { RuleDefinition } from "../types.js";

export const rules: RuleDefinition[] = [
  {
    name: "no-v-html",
    defaultSeverity: "error",
    category: "Security",
    description: "Avoid v-html because unsanitized HTML can become XSS.",
  },
  {
    name: "no-target-blank-without-rel",
    defaultSeverity: "error",
    category: "Security",
    description: "Require rel=\"noopener noreferrer\" with target=\"_blank\".",
  },
  {
    name: "no-eval",
    defaultSeverity: "error",
    category: "Security",
    description: "Disallow eval, new Function, and string timers.",
  },
  {
    name: "no-hardcoded-secret",
    defaultSeverity: "error",
    category: "Security",
    description: "Flag likely secrets committed to client code.",
  },
  {
    name: "require-v-for-key",
    defaultSeverity: "error",
    category: "Correctness",
    description: "Require stable keys on v-for nodes.",
  },
  {
    name: "no-index-key",
    defaultSeverity: "warning",
    category: "Correctness",
    description: "Avoid using the v-for index as a key.",
  },
  {
    name: "no-v-if-with-v-for",
    defaultSeverity: "warning",
    category: "Correctness",
    description: "Avoid mixing v-if and v-for on the same node.",
  },
  {
    name: "no-template-side-effects",
    defaultSeverity: "error",
    category: "Correctness",
    description: "Keep template expressions pure.",
  },
  {
    name: "no-mutating-props",
    defaultSeverity: "error",
    category: "Correctness",
    description: "Avoid mutating props directly.",
  },
  {
    name: "no-vue2-deprecated-api",
    defaultSeverity: "warning",
    category: "Correctness",
    description: "Flag Vue 2 APIs in Vue 3 projects.",
  },
  {
    name: "no-expensive-template-expression",
    defaultSeverity: "warning",
    category: "Performance",
    description: "Move expensive template work into computed values.",
  },
  {
    name: "no-deep-watch",
    defaultSeverity: "warning",
    category: "Performance",
    description: "Avoid deep watchers unless the watched shape is tightly bounded.",
  },
  {
    name: "watch-requires-cleanup",
    defaultSeverity: "warning",
    category: "Performance",
    description: "Async watchers should use cleanup or cancellation.",
  },
  {
    name: "require-img-alt",
    defaultSeverity: "warning",
    category: "Accessibility",
    description: "Require alt text on img tags.",
  },
  {
    name: "require-button-name",
    defaultSeverity: "warning",
    category: "Accessibility",
    description: "Require an accessible name for icon-only buttons.",
  },
  {
    name: "no-autofocus",
    defaultSeverity: "warning",
    category: "Accessibility",
    description: "Avoid autofocus stealing focus on navigation.",
  },
  {
    name: "no-large-component",
    defaultSeverity: "warning",
    category: "Architecture",
    description: "Flag very large single-file components.",
  },
  {
    name: "no-too-many-props",
    defaultSeverity: "warning",
    category: "Architecture",
    description: "Flag components with broad prop APIs.",
  },
  {
    name: "prefer-scoped-style",
    defaultSeverity: "warning",
    category: "Maintainability",
    description: "Prefer scoped or module styles in SFCs.",
  },
];

export const ruleByName = new Map(rules.map((rule) => [rule.name, rule]));

export const normalizeRuleName = (rule: string): string => rule.replace(/^vue-doctor\//, "");
