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
});
