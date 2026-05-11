export { diagnose, summarizeDiagnostics, toJsonReport } from "./scanner.js";
export { rules } from "./rules/index.js";
export type {
  Diagnostic,
  DiagnoseOptions,
  DiagnoseResult,
  FailOnLevel,
  JsonReport,
  ProjectInfo,
  RuleDefinition,
  RuleLevel,
  ScoreResult,
  Severity,
  VueDoctorConfig,
} from "./types.js";
