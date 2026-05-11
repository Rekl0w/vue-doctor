# Local Testing

Use this when you want to run the local checkout of Vue Doctor against one of your real Vue projects before publishing to npm.

## Prerequisites

- Node.js `20.12` or newer
- npm `10` or newer
- A Vue project with `package.json`

Check your machine:

```powershell
node --version
npm --version
```

## Option 1: Live Local Link

This is best while developing Vue Doctor because every rebuild updates the linked command.

From this repo:

```powershell
cd C:\Users\Windows\Desktop\vue-doctor
npm install
npm run local:link
```

From your Vue project:

```powershell
cd C:\Users\Windows\Desktop\your-vue-project
vue-doctor . --verbose
vue-doctor . --json > vue-doctor-report.json
vue-doctor . --fail-on warning
```

When you are done testing:

```powershell
npm unlink -g @rekl0w/vue-doctor
```

## Option 2: Install The Local Tarball

This is closest to how users will install the published npm package.

From this repo:

```powershell
cd C:\Users\Windows\Desktop\vue-doctor
npm install
npm run local:pack
```

From your Vue project:

```powershell
cd C:\Users\Windows\Desktop\your-vue-project
npm install -D C:\Users\Windows\Desktop\vue-doctor\.local-pack\rekl0w-vue-doctor-0.1.1.tgz
npx vue-doctor . --verbose
```

Remove the local test package later:

```powershell
npm uninstall @rekl0w/vue-doctor
```

## Useful Smoke Commands

```powershell
vue-doctor . --score
vue-doctor . --json
vue-doctor src --include src
vue-doctor . --fail-on none
vue-doctor . --fail-on error
vue-doctor . --annotations
```

## Expected Output

The CLI should print a `Vue Doctor` score line and diagnostics grouped by category. JSON mode should print one valid JSON object with `schemaVersion`, `project`, `diagnostics`, and `summary`.
