<h1>Vue Doctor</h1>

[![version](https://img.shields.io/npm/v/%40rekl0w%2Fvue-doctor?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/@rekl0w/vue-doctor)
[![license](https://img.shields.io/npm/l/%40rekl0w%2Fvue-doctor?style=flat&colorA=000000&colorB=000000)](./LICENSE)

Your agent writes risky Vue. This catches the boring mistakes before they ship.

Vue Doctor scans Vue codebases and returns a 0 to 100 health score with actionable diagnostics for security, correctness, performance, accessibility, and component architecture.

It understands Vue single-file components through the official Vue compiler, so it can inspect real `<template>`, `<script setup>`, classic `<script>`, and `<style>` blocks instead of pretending `.vue` files are plain text.

## Install

Run this at your project root:

```bash
npx -y @rekl0w/vue-doctor .
```

Or install it in a repo:

```bash
npm install -D @rekl0w/vue-doctor
npx vue-doctor .
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
| Performance | `no-expensive-template-expression`, `no-deep-watch`, `watch-requires-cleanup` |
| Accessibility | `require-img-alt`, `require-button-name`, `no-autofocus` |
| Architecture | `no-large-component`, `no-too-many-props` |
| Maintainability | `prefer-scoped-style` |

The scanner respects `.gitignore`, `.eslintignore`, `.prettierignore`, `.vue-doctorignore`, and `vue-doctor.config.json` ignores.

## CLI

```text
Usage: vue-doctor [directory] [options]

Options:
  -v, --version          display the version number
  --verbose              show every diagnostic
  --json                 output a structured JSON report
  --score                output only the numeric score
  --annotations          output GitHub Actions annotations
  --fail-on <level>      exit with error on diagnostics: error, warning, none
  --config <path>        path to vue-doctor.config.json
  --include <path>       file or directory to scan; repeat or comma-separate
  -h, --help             display help
```

Examples:

```bash
npx vue-doctor .
npx vue-doctor apps/web --verbose
npx vue-doctor . --json > vue-doctor-report.json
npx vue-doctor . --fail-on warning
```

## Configuration

Create `vue-doctor.config.json` in your repo:

```json
{
  "failOn": "warning",
  "maxComponentLines": 320,
  "maxProps": 12,
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
      - uses: Rekl0w/vue-doctor@v0.1.0
        with:
          directory: .
          fail-on: warning
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Prefer not to use the action? The package works directly:

```yaml
- run: npx -y @rekl0w/vue-doctor . --fail-on warning --annotations
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
