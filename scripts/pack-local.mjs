import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const run = (command, args) => {
  const executable =
    command === "npm" && process.env.npm_execpath ? process.execPath : command;
  const finalArgs =
    command === "npm" && process.env.npm_execpath
      ? [process.env.npm_execpath, ...args]
      : args;
  const result = spawnSync(executable, finalArgs, {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

mkdirSync(".local-pack", { recursive: true });
run("npm", ["run", "check"]);
run("npm", ["pack", "--pack-destination", ".local-pack", "--ignore-scripts"]);
