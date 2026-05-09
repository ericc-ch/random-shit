#!/usr/bin/env -S deno run -A

import { dirname, fromFileUrl, join } from "jsr:@std/path@1";

const repositories = [
  {
    name: "Effect v4",
    directory: "effect-smol",
    url: "https://github.com/Effect-TS/effect-smol.git",
  },
  {
    name: "OpenCode",
    directory: "opencode",
    url: "https://github.com/anomalyco/opencode.git",
  },
] as const;

const scriptDir = dirname(fromFileUrl(import.meta.url));
const projectRoot = dirname(scriptDir);
const referencesDir = join(projectRoot, ".references");

const existsSync = (path: string) => {
  try {
    Deno.statSync(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
};

const run = (
  command: string,
  args: ReadonlyArray<string>,
  cwd = projectRoot,
) => {
  const { code, success } = new Deno.Command(command, {
    args: [...args],
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }).outputSync();

  if (!success) {
    Deno.exit(code);
  }
};

console.log("Setting up .references/ directory...");

Deno.mkdirSync(referencesDir, { recursive: true });

for (const repository of repositories) {
  const repositoryPath = join(referencesDir, repository.directory);

  if (existsSync(repositoryPath)) {
    console.log(`Pulling ${repository.name} updates...`);
    run("git", ["pull", "--ff-only"], repositoryPath);
  } else {
    console.log(`Cloning ${repository.name}...`);
    run(
      "git",
      ["clone", "--depth", "1", repository.url, repository.directory],
      referencesDir,
    );
  }
}

console.log("");
console.log("All reference repositories are up to date!");
console.log("");
console.log("Repositories:");
for (
  const entry of [...Deno.readDirSync(referencesDir)].map((e) => e.name).sort()
) {
  console.log(entry);
}
