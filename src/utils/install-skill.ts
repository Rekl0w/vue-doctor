import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import {
  getSkillAgentConfig,
  installSkillsFromSource,
  SKILL_MANIFEST_FILE,
  type SkillAgentType,
} from "agent-install";
import { detectAvailableAgents } from "./detect-agents.js";

interface InstallSkillOptions {
  yes?: boolean | undefined;
  dryRun?: boolean | undefined;
  cwd?: string | undefined;
  sourceDir?: string | undefined;
  detectedAgents?: SkillAgentType[] | undefined;
}

const SKILL_NAME = "vue-doctor";

const getSkillSourceDirectory = (): string => {
  const distDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(distDirectory, "..", "skills", SKILL_NAME);
};

const formatAgent = (agent: SkillAgentType): string => getSkillAgentConfig(agent).displayName;

const selectAgents = async (
  detectedAgents: SkillAgentType[],
  yes: boolean | undefined,
): Promise<SkillAgentType[]> => {
  if (yes || !process.stdin.isTTY) return detectedAgents;

  console.log("Detected coding agents:");
  detectedAgents.forEach((agent, index) => {
    console.log(`  ${index + 1}. ${formatAgent(agent)}`);
  });

  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question("Install Vue Doctor skill for (comma-separated, Enter for all): ");
    const trimmed = answer.trim();
    if (!trimmed) return detectedAgents;

    const selected = trimmed
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= detectedAgents.length)
      .map((entry) => detectedAgents[entry - 1])
      .filter((agent): agent is SkillAgentType => Boolean(agent));

    return [...new Set(selected)];
  } finally {
    readline.close();
  }
};

export const runInstallSkill = async (options: InstallSkillOptions = {}): Promise<void> => {
  const projectRoot = options.cwd ?? process.cwd();
  const sourceDir = options.sourceDir ?? getSkillSourceDirectory();

  if (!existsSync(path.join(sourceDir, SKILL_MANIFEST_FILE))) {
    throw new Error(`Could not locate the bundled ${SKILL_NAME} skill at ${sourceDir}.`);
  }

  const detectedAgents = options.detectedAgents ?? (await detectAvailableAgents());
  if (detectedAgents.length === 0) {
    throw new Error(
      "No supported coding agents detected. Run with an agent installed, or install the skill manually from the package's skills/vue-doctor folder.",
    );
  }

  const selectedAgents = await selectAgents(detectedAgents, options.yes);
  if (selectedAgents.length === 0) {
    console.log(pc.dim("No agents selected."));
    return;
  }

  if (options.dryRun) {
    console.log(`Dry run - would install ${SKILL_NAME} for:`);
    for (const agent of selectedAgents) {
      console.log(pc.dim(`  - ${formatAgent(agent)}`));
    }
    console.log(pc.dim(`Source: ${sourceDir}`));
    return;
  }

  const result = await installSkillsFromSource({
    source: sourceDir,
    agents: selectedAgents,
    cwd: projectRoot,
    mode: "copy",
  });

  if (result.skills.length === 0) {
    throw new Error(`Could not parse ${SKILL_MANIFEST_FILE} for ${SKILL_NAME}.`);
  }

  if (result.failed.length > 0) {
    throw new Error(
      result.failed
        .map((failure) => `${formatAgent(failure.agent)}: ${failure.error}`)
        .join("\n"),
    );
  }

  console.log(
    pc.green(
      `${SKILL_NAME} skill installed for ${selectedAgents.map((agent) => formatAgent(agent)).join(", ")}.`,
    ),
  );
};
