export { diagnose, summarizeDiagnostics, toJsonReport, toJsonReportFromScans } from "./scanner.js";
export { toMarkdownReport, toSarifReport } from "./reporters.js";
export { rules } from "./rules/index.js";
export type {
  Diagnostic,
  DiffInfo,
  DiagnoseOptions,
  DiagnoseResult,
  FailOnLevel,
  JsonReport,
  JsonReportMode,
  ProjectInfo,
  RuleDefinition,
  RuleLevel,
  ScoreResult,
  Severity,
  VueDoctorConfig,
  VueDoctorPreset,
} from "./types.js";
