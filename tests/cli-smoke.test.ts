import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];
const repoRoot = path.resolve(import.meta.dirname, "..");

const makeProject = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vue-doctor-cli-smoke-"));
  tempRoots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { vue: "^3.5.0", vite: "^7.0.0" } }),
  );
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "App.vue"), "<template><img src=\"/logo.png\"></template>\n");
  return root;
};

const runCli = (args: string[]): string => {
  const result = spawnSync(process.execPath, ["bin/vue-doctor.js", ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `vue-doctor ${args.join(" ")} failed`);
  }
  return result.stdout;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CLI smoke", () => {
  it("prints detailed version information", () => {
    const output = runCli(["version"]);
    expect(output).toContain("vue-doctor 0.4.0");
    expect(output).toContain("node ");
  });

  it("emits JSON, Markdown, and SARIF reports", () => {
    const root = makeProject();

    const json = JSON.parse(runCli([root, "--json", "--fail-on", "none"])) as {
      summary: { totalDiagnosticCount: number };
    };
    expect(json.summary.totalDiagnosticCount).toBe(1);

    const markdown = runCli([root, "--markdown", "--fail-on", "none"]);
    expect(markdown).toContain("# Vue Doctor Report");
    expect(markdown).toContain("vue-doctor/require-img-alt");

    const sarif = JSON.parse(runCli([root, "--sarif", "--json-compact", "--fail-on", "none"])) as {
      version: string;
      runs: Array<{ results: Array<{ ruleId: string }> }>;
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results[0]?.ruleId).toBe("vue-doctor/require-img-alt");
  });

  it("prints a branded human report with source frames", () => {
    const root = makeProject();
    const output = runCli([root, "--verbose", "--fail-on", "none", "--handoff", "skip"]);

    expect(output).toContain("Vue Doctor");
    expect(output).toContain("Vue-native diagnostics for agents, reviews, and CI.");
    expect(output).toContain("Analyzing Vue source");
    expect(output).toContain("require-img-alt");
    expect(output).toContain("| <template><img src=\"/logo.png\"></template>");
  });

  it("can write and apply a diagnostics baseline", () => {
    const root = makeProject();
    const baselinePath = path.join(root, "vue-doctor-baseline.json");

    const raw = JSON.parse(runCli([root, "--json", "--fail-on", "none", "--update-baseline", baselinePath])) as {
      summary: { totalDiagnosticCount: number };
    };
    expect(raw.summary.totalDiagnosticCount).toBe(1);
    expect(fs.existsSync(baselinePath)).toBe(true);

    const filtered = JSON.parse(runCli([root, "--json", "--fail-on", "none", "--baseline", baselinePath])) as {
      summary: { totalDiagnosticCount: number; score: number };
    };
    expect(filtered.summary.totalDiagnosticCount).toBe(0);
    expect(filtered.summary.score).toBe(100);
  });

  it("can scan a changed-files list without relying on local git diff state", () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, "src", "App.vue"), "<template><p>ok</p></template>\n");
    fs.writeFileSync(path.join(root, "src", "Changed.vue"), "<template><p v-html=\"html\"></p></template>\n");
    const changedFilesPath = path.join(root, "changed-files.txt");
    fs.writeFileSync(changedFilesPath, "src/Changed.vue\n");

    const json = JSON.parse(
      runCli([root, "--json", "--fail-on", "none", "--changed-files-from", changedFilesPath]),
    ) as {
      mode: string;
      diagnostics: Array<{ relativePath: string; rule: string }>;
      summary: { totalDiagnosticCount: number };
    };

    expect(json.mode).toBe("changed-files");
    expect(json.summary.totalDiagnosticCount).toBe(1);
    expect(json.diagnostics[0]?.relativePath).toBe("src/Changed.vue");
    expect(json.diagnostics[0]?.rule).toBe("no-v-html");
  });

  it("can scan with experimental worker-thread parallelism", () => {
    const root = makeProject();
    fs.writeFileSync(path.join(root, "src", "Clean.vue"), "<template><p>ok</p></template>\n");

    const json = JSON.parse(
      runCli([root, "--json", "--fail-on", "none", "--experimental-parallel", "2"]),
    ) as {
      diagnostics: Array<{ rule: string }>;
      summary: { totalDiagnosticCount: number };
    };

    expect(json.summary.totalDiagnosticCount).toBe(1);
    expect(json.diagnostics[0]?.rule).toBe("require-img-alt");
  });

  it("previews the expanded install onboarding flow", () => {
    const root = makeProject();
    const output = runCli(["install", "--dry-run", "--cwd", root, "--agent-hooks"]);

    expect(output).toContain("Dry run");
    expect(output).toContain("package script");
    expect(output).toContain("GitHub Action");
    expect(output).toContain("native agent hooks");
  });
});
