<h1>Vue Doctor</h1>

[![version](https://img.shields.io/npm/v/%40rekl0w%2Fvue-doctor?style=flat)](https://www.npmjs.com/package/@rekl0w/vue-doctor)
[![license](https://img.shields.io/github/license/Rekl0w/vue-doctor?style=flat)](./LICENSE)

Your agent writes risky Vue. This catches the boring mistakes before they ship.

Vue Doctor scans Vue codebases and returns a 0 to 100 health score with actionable diagnostics for security, correctness, performance, accessibility, and component architecture.

It understands Vue single-file components through the official Vue compiler, so it can inspect real `<template>`, `<script setup>`, classic `<script>`, and `<style>` blocks instead of pretending `.vue` files are plain text.

## Install

Run this at your project root:

```bash
npx @rekl0w/vue-doctor@latest
```

Teach your coding agent the same Vue rules:

```bash
npx @rekl0w/vue-doctor@latest install
```

Use `--yes` to install for every detected agent without prompts, or `--dry-run` to preview the targets.

Or install it in a repo:

```bash
npm install -D @rekl0w/vue-doctor
npx vue-doctor
```

The CLI prints a score:

- 75 to 100: Great
- 50 to 74: Needs work
- 0 to 49: Critical

Default output is compact: Vue Doctor groups diagnostics by category and rule, shows the most important examples, prints the score at the bottom, and writes the full JSON report to a temp file. Use `--verbose` when you want every file-level diagnostic in the terminal.

## What It Checks

Vue Doctor ships with focused rules that catch problems Vue teams repeatedly review by hand:

| Category | Rules |
| --- | --- |
| Security | `no-v-html`, `no-target-blank-without-rel`, `no-eval`, `no-hardcoded-secret` |
| Correctness | `require-v-for-key`, `no-index-key`, `no-v-if-with-v-for`, `no-template-side-effects`, `no-mutating-props`, `no-vue2-deprecated-api` |
| Performance | `no-expensive-template-expression`, `no-deep-watch`, `watch-requires-cleanup`, `no-transition-all`, `no-permanent-will-change` |
| Accessibility | `require-img-alt`, `require-button-name`, `no-autofocus`, `no-disabled-zoom` |
| Architecture | `no-large-component`, `no-too-many-props` |
| Maintainability | `prefer-scoped-style` |
| Bundle Size | `no-full-lodash-import`, `no-moment`, `prefer-dynamic-import` |
| Design | `no-outline-none`, `no-tiny-text`, `no-wide-letter-spacing`, `no-z-index-9999`, `no-pure-black-background`, `no-gradient-text` |

The scanner respects `.gitignore`, `.eslintignore`, `.prettierignore`, `.vue-doctorignore`, and `vue-doctor.config.json` ignores.

## CLI

```text
Usage: vue-doctor [directory] [options]

Options:
  -v, --version          display the version number
  --verbose              show every diagnostic
  --json                 output a structured JSON report
  --json-compact         with --json, emit compact JSON
  --score                output only the numeric score
  --annotations          output GitHub Actions annotations
  --project <name>       workspace project(s) to scan
  --diff [base]          scan changed files vs base branch
  --staged               scan staged git files
  --full                 force a full scan
  --offline              accepted for React Doctor parity; scoring is local
  --fail-on <level>      exit with error on diagnostics: error, warning, none (default: error)
  --config <path>        path to vue-doctor.config.json
  --include <path>       file or directory to scan; repeat or comma-separate
  --explain <file:line>  show active and suppressed diagnostics near a line
  -h, --help             display help
```

Examples:

```bash
npx @rekl0w/vue-doctor@latest
npx vue-doctor apps/web --verbose
npx vue-doctor --diff main --fail-on warning
npx vue-doctor --staged
npx vue-doctor --project web,admin --json
npx vue-doctor --json > vue-doctor-report.json
npx vue-doctor --fail-on warning
```

## Configuration

Create `vue-doctor.config.json` in your repo:

```json
{
  "failOn": "warning",
  "diff": "main",
  "maxComponentLines": 320,
  "maxProps": 12,
  "categories": {
    "Design": "off",
    "Bundle Size": "warning"
  },
  "ignore": {
    "rules": ["vue-doctor/prefer-scoped-style"],
    "files": ["src/generated/**"],
    "overrides": [
      {
        "files": ["src/legacy/**"],
        "rules": ["vue-doctor/no-vue2-deprecated-api"]
      }
    ]
  },
  "rules": {
    "vue-doctor/no-v-html": "error",
    "vue-doctor/no-deep-watch": "warning",
    "vue-doctor/require-button-name": "off"
  }
}
```

You can also place the same object under `vueDoctor` in `package.json`.

### Inline Suppressions

Use the narrowest suppression possible:

```vue
<!-- vue-doctor-disable-next-line vue-doctor/no-v-html -->
<div v-html="trustedHtml" />
```

Script comments work too:

```ts
// vue-doctor-disable-next-line vue-doctor/no-hardcoded-secret
const demoToken = "not-a-real-token-for-docs";
```

## GitHub Actions

This repository includes a composite action. Use it from this repo after publishing or referencing a tag:

```yaml
name: Vue Doctor

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  vue-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: Rekl0w/vue-doctor@v0.2.0
        id: vue-doctor
        with:
          directory: .
          diff: main
          fail-on: warning
          annotations: true
          json: true
          report-path: vue-doctor-report.json
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: vue-doctor-report
          path: ${{ steps.vue-doctor.outputs['report-path'] }}
```

When `github-token` is set on pull requests, the action updates one Vue Doctor comment with a Markdown summary table and grouped diagnostics. The raw CLI output remains available in the workflow logs.

The action exposes the numeric health score as an output:

```yaml
${{ steps.vue-doctor.outputs.score }}
```

Inputs: `directory`, `verbose`, `project`, `diff`, `github-token`, `fail-on`, `offline`, `annotations`, `json`, `report-path`, and `node-version`.

Prefer not to use the action? The package works directly:

```yaml
- run: npx @rekl0w/vue-doctor@latest --fail-on warning --annotations
- run: npx @rekl0w/vue-doctor@latest --json --fail-on none > vue-doctor-report.json
```

## Node API

```ts
import { diagnose, toJsonReport } from "@rekl0w/vue-doctor/api";

const result = await diagnose("./apps/web");

console.log(result.score);
console.log(result.diagnostics);
console.log(toJsonReport("./apps/web", result));
```

## Publishing Checklist

1. Confirm your npm account has publish access to the `@rekl0w` scope.
2. Confirm the GitHub repository is `Rekl0w/vue-doctor`.
3. Run `npm run check`.
4. Run `npm publish --access public`.
5. Tag the release if you want the GitHub Action path to be stable.

## References

Vue Doctor was built with [`millionco/react-doctor`](https://github.com/millionco/react-doctor) as the product and package-quality reference: CLI-first workflow, score output, CI action, JSON reports, config ergonomics, and open-source repository hygiene. The implementation here is Vue-native rather than a port: it uses the official Vue compiler to inspect SFC templates, scripts, and styles.

## License

MIT
