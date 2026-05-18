---
name: vue-doctor
description: Use before committing Vue, Nuxt, Vite Vue, Vue CLI, Quasar, VitePress, or VuePress code, or when cleaning up Vue code quality. Checks for score regressions, security, correctness, performance, accessibility, bundle-size, design, and component architecture diagnostics.
---

# Vue Doctor

Vue Doctor scans Vue codebases and returns a 0-100 health score with actionable diagnostics.

## Quick Checks

Before committing Vue changes, run:

```bash
npx @rekl0w/vue-doctor@latest --verbose --diff
```

If the score drops or new errors appear, fix those regressions before committing.

## Full Scan

Run a full codebase scan when starting cleanup work:

```bash
npx @rekl0w/vue-doctor@latest --verbose --full
```

Fix errors first, then warnings. Use focused flags for automation:

| Flag | Purpose |
| --- | --- |
| `--diff [base]` | Scan changed Vue source files vs the base branch |
| `--staged` | Scan staged source files for pre-commit workflows |
| `--project <name>` | Scan one or more workspace projects |
| `--score` | Output only the numeric health score |
| `--json` | Output a structured machine-readable report |
| `--fail-on warning` | Fail on any diagnostic |

## Suppressions

Prefer fixing findings. When a suppression is intentional, keep it narrow:

```vue
<!-- vue-doctor-disable-next-line vue-doctor/no-v-html -->
<div v-html="trustedHtml" />
```

Use `--no-respect-inline-disables` for an audit scan that ignores local suppressions.
