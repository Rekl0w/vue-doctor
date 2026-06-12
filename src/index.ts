export { diagnose, summarizeDiagnostics, toJsonReport, toJsonReportFromScans } from "./scanner.js";
export { toMarkdownReport, toSarifReport } from "./reporters.js";
export { rules } from "./rules/index.js";
export type {
  Diagnostic,
  ChangedLineRanges,
  DiffInfo,
  DiagnoseOptions,
  DiagnoseResult,
  FailOnLevel,
  JsonReport,
  JsonReportMode,
  ProjectInfo,
  RuleDefinition,
  RuleLevel,
  ScanScope,
  ScoreResult,
  Severity,
  VueDoctorConfig,
  VueDoctorPreset,
} from "./types.js";
