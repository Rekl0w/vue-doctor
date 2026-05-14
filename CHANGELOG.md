# Changelog

## 0.1.2

- Added GitHub Action inputs for `annotations`, `json`, and `report-path`.
- Added a `report-path` action output for JSON report artifact workflows.
- Kept the human-readable PR comment output separate from GitHub Actions annotations.
- Kept score/report/comment steps running even when the configured CI gate fails.
- Documented score outputs, annotations, and JSON artifact usage in CI.

## 0.1.1

- Renamed the GitHub Marketplace action to `Rekl0w Vue Doctor` so it can be published with a unique Marketplace name.
- Kept the CLI command as `vue-doctor` and the npm package as `@rekl0w/vue-doctor`.
- Refreshed package metadata for npm publishing.

## 0.1.0

- Initial Vue Doctor CLI and Node API.
- Vue SFC scanning through the official Vue compiler.
- Diagnostics for security, correctness, performance, accessibility, architecture, and maintainability.
- JSON reports, score-only output, GitHub Actions annotations, config file support, ignores, and inline suppressions.
