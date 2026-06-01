export type Severity = "error" | "warning";

export type FailOnLevel = "error" | "warning" | "none";

export type RuleLevel = Severity | "off";

export type VueDoctorPreset = "recommended" | "strict" | "design";

export type DiagnosticCategory =
  | "Security"
  | "Correctness"
  | "Performance"
  | "Accessibility"
  | "Architecture"
  | "Maintainability"
  | "Bundle Size"
  | "Design";

export interface Diagnostic {
  filePath: string;
  relativePath: string;
  plugin: "vue-doctor";
  rule: string;
  severity: Severity;
  category: DiagnosticCategory;
  message: string;
  help: string;
  line: number;
  column: number;
}

export interface DiagnosticInput {
  rule: string;
  severity?: Severity;
  category: DiagnosticCategory;
  message: string;
  help: string;
  line: number;
  column?: number;
}

export interface VueDoctorIgnoreOverride {
  files: string[];
  rules?: string[] | undefined;
}

export interface VueDoctorIgnoreConfig {
  rules?: string[] | undefined;
  files?: string[] | undefined;
  overrides?: VueDoctorIgnoreOverride[] | undefined;
}

export interface VueDoctorConfig {
  rootDir?: string | undefined;
  preset?: VueDoctorPreset | undefined;
  ignore?: VueDoctorIgnoreConfig | undefined;
  rules?: Record<string, RuleLevel> | undefined;
  categories?: Record<string, RuleLevel> | undefined;
  verbose?: boolean | undefined;
  failOn?: FailOnLevel | undefined;
  diff?: boolean | string | undefined;
  baseline?: string | undefined;
  include?: string[] | undefined;
  maxComponentLines?: number | undefined;
  maxProps?: number | undefined;
  respectInlineDisables?: boolean | undefined;
}

export type VueFramework =
  | "nuxt"
  | "vite"
  | "vue-cli"
  | "quasar"
  | "vitepress"
  | "vuepress"
  | "unknown";

export interface ProjectInfo {
  rootDirectory: string;
  projectName: string;
  hasVue: boolean;
  vueVersion: string | null;
  framework: VueFramework;
  hasTypeScript: boolean;
  hasPinia: boolean;
  hasVueRouter: boolean;
  sourceFileCount: number;
}

export interface ScoreResult {
  score: number;
  label: "Great" | "Needs work" | "Critical";
}

export interface DiagnoseOptions {
  lint?: boolean | undefined;
  verbose?: boolean | undefined;
  includePaths?: string[] | undefined;
  config?: VueDoctorConfig | null | undefined;
  configPath?: string | undefined;
  respectInlineDisables?: boolean | undefined;
  parallelWorkers?: number | undefined;
}

export interface DiagnoseResult {
  diagnostics: Diagnostic[];
  score: ScoreResult;
  project: ProjectInfo;
  elapsedMilliseconds: number;
}

export type JsonReportMode = "full" | "diff" | "staged" | "changed-files";

export interface DiffInfo {
  currentBranch: string;
  baseBranch: string;
  changedFiles: string[];
  isCurrentChanges?: boolean | undefined;
}

export interface JsonReportSummary {
  errorCount: number;
  warningCount: number;
  affectedFileCount: number;
  totalDiagnosticCount: number;
  score: number;
  scoreLabel: ScoreResult["label"];
}

export interface JsonReport {
  schemaVersion: 1;
  version: string;
  ok: boolean;
  directory: string;
  mode?: JsonReportMode | undefined;
  diff?: DiffInfo | null | undefined;
  project: ProjectInfo;
  projects?: Array<{
    directory: string;
    project: ProjectInfo;
    diagnostics: Diagnostic[];
    summary: JsonReportSummary;
    elapsedMilliseconds: number;
  }> | undefined;
  diagnostics: Diagnostic[];
  summary: JsonReportSummary;
  elapsedMilliseconds: number;
}

export interface RuleDefinition {
  name: string;
  defaultSeverity: Severity;
  category: DiagnosticCategory;
  description: string;
}

export interface ScanContext {
  rootDirectory: string;
  relativePath: string;
  filePath: string;
  source: string;
  config: VueDoctorConfig;
  project: ProjectInfo;
  report: (diagnostic: DiagnosticInput) => void;
}
