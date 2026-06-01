import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import pc from "picocolors";

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string | undefined;
}

const SPINNER_FRAMES = ["-", "\\", "|", "/"];

export const canPrompt = (): boolean =>
  Boolean(process.stdin.isTTY && process.stdout.isTTY && process.env.CI !== "true");

export const formatElapsed = (milliseconds: number): string =>
  milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${Math.round(milliseconds)}ms`;

export const printBrandHeader = (
  version: string,
  details: Array<[string, string | number | undefined | null]>,
): void => {
  const width = 64;
  const border = "=".repeat(width);
  console.log(pc.green(border));
  console.log(`${pc.bold("Vue Doctor")} ${pc.dim(`v${version}`)}`);
  console.log(pc.dim("Vue-native diagnostics for agents, reviews, and CI."));
  for (const [label, value] of details) {
    if (value === undefined || value === null || value === "") continue;
    console.log(`${pc.dim(`${label}:`)} ${value}`);
  }
  console.log(pc.green(border));
  console.log("");
};

export const promptChoice = async <T extends string>(
  question: string,
  choices: Array<Choice<T>>,
  defaultValue: T,
): Promise<T> => {
  if (!canPrompt()) return defaultValue;

  console.log("");
  console.log(pc.bold(question));
  choices.forEach((choice, index) => {
    const hint = choice.hint ? pc.dim(` - ${choice.hint}`) : "";
    console.log(`  ${index + 1}. ${choice.label}${hint}`);
  });

  const defaultIndex = Math.max(0, choices.findIndex((choice) => choice.value === defaultValue));
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(`Choose an option (Enter for ${defaultIndex + 1}): `);
    const selectedIndex = answer.trim().length === 0 ? defaultIndex : Number(answer.trim()) - 1;
    return choices[selectedIndex]?.value ?? defaultValue;
  } finally {
    readline.close();
  }
};

export const promptConfirm = async (
  question: string,
  defaultValue: boolean,
): Promise<boolean> => {
  if (!canPrompt()) return defaultValue;
  const suffix = defaultValue ? "Y/n" : "y/N";
  const readline = createInterface({ input, output });
  try {
    const answer = (await readline.question(`${question} (${suffix}) `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
};

export const runProductStep = async <T>(
  label: string,
  task: () => Promise<T>,
  detail?: (result: T) => string | undefined,
): Promise<T> => {
  const start = performance.now();
  let frameIndex = 0;
  let timer: NodeJS.Timeout | null = null;

  if (process.stdout.isTTY) {
    process.stdout.write(`${SPINNER_FRAMES[0]} ${label}`);
    timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
      process.stdout.write(`\r${SPINNER_FRAMES[frameIndex]} ${label}`);
    }, 80);
  } else {
    console.log(`- ${label}`);
  }

  try {
    const result = await task();
    if (timer) clearInterval(timer);
    const suffix = detail?.(result);
    const line = `${pc.green("OK")} ${label}${suffix ? pc.dim(` - ${suffix}`) : ""} ${pc.dim(`(${formatElapsed(performance.now() - start)})`)}`;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${line}\n`);
    } else {
      console.log(line);
    }
    return result;
  } catch (error) {
    if (timer) clearInterval(timer);
    const line = `${pc.red("x")} ${label} ${pc.dim(`(${formatElapsed(performance.now() - start)})`)}`;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${line}\n`);
    } else {
      console.log(line);
    }
    throw error;
  }
};
