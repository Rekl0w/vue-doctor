# Changelog

## 0.3.0

- Added `--markdown` and `--sarif` report formats, plus Node API helpers for generating Markdown and SARIF from JSON reports.
- Added `recommended`, `strict`, and `design` presets with CLI and config support.
- Added diagnostics baseline support through `--update-baseline`, `--baseline`, and the matching config field.
- Added Vue/Nuxt-focused checks for public runtime secrets, top-level SSR browser globals, and hydration-unstable template expressions.
- Reworked script scanning to use parser-aware AST traversal instead of raw regex matching for imports, eval, prop mutation, watcher cleanup, secrets, deprecated Vue 2 APIs, and deep watchers.
- Fixed noisy false positives from fixture strings, regex literals, rule title maps, bound `rel` attributes, and buttons with nested text.
- Fixed `v-for` index alias detection for two-alias forms such as `(item, idx) in items`.
- Added CLI smoke tests for JSON, Markdown, SARIF, and baseline behavior.
- Updated the GitHub Action with preset, baseline, Markdown, and SARIF inputs and pinned the internal npm invocation to the action release version.

## 0.2.0

- Added React Doctor-style CLI workflows: `--diff`, `--staged`, `--project`, `--full`, `--json-compact`, `--offline`, and `--explain`.
- Added the `vue-doctor install` command and bundled coding-agent skill instructions.
- Added GitHub Action inputs for `project`, `diff`, and `offline`.
- Added bundle-size, design, and style-performance rule families.
- Changed the recommended one-shot command to `npx @rekl0w/vue-doctor@latest`.
- Avoided reporting a misleading score when `--staged --score` has no staged Vue source files.

## 0.1.3

- Changed GitHub Action pull request comments to render Markdown summaries from JSON reports instead of raw ANSI terminal output.

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
