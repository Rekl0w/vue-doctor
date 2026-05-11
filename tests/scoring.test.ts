import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/types.js";
import { calculateScore } from "../src/utils/scoring.js";

const makeDiagnostic = (
  overrides: Partial<Diagnostic> & Pick<Diagnostic, "rule" | "severity" | "category">,
  index: number,
): Diagnostic => ({
  filePath: `/repo/src/File${index}.vue`,
  relativePath: `src/File${index}.vue`,
  plugin: "vue-doctor",
  message: "message",
  help: "help",
  line: 1,
  column: 1,
  ...overrides,
});

describe("calculateScore", () => {
  it("caps repeated findings so large projects do not collapse to zero from duplicated rules", () => {
    const diagnostics = [
      ...Array.from({ length: 200 }, (_, index) =>
        makeDiagnostic(
          {
            rule: "no-large-component",
            severity: "warning",
            category: "Architecture",
          },
          index,
        ),
      ),
      ...Array.from({ length: 100 }, (_, index) =>
        makeDiagnostic(
          {
            rule: "no-mutating-props",
            severity: "error",
            category: "Correctness",
          },
          index + 200,
        ),
      ),
    ];

    const score = calculateScore(diagnostics, { totalSourceFiles: 600 });

    expect(score.score).toBeGreaterThan(55);
    expect(score.score).toBeLessThan(90);
  });

  it("does not label scans with errors as great", () => {
    const score = calculateScore(
      [
        makeDiagnostic(
          {
            rule: "no-v-html",
            severity: "error",
            category: "Security",
          },
          0,
        ),
      ],
      { totalSourceFiles: 1 },
    );

    expect(score.score).toBeLessThan(75);
    expect(score.label).toBe("Needs work");
  });
});
