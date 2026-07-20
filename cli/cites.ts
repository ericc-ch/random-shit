#!/usr/bin/env -S deno run -A

import yargs from "yargs";
import type { ArgumentsCamelCase, Argv } from "yargs";

interface CliOptions {
  text?: string;
}

function cleanCites(text: string): string {
  // Remove cite_start and cite: XX (or cite: XX, YY, ZZ) markers
  const cleaned = text.replace(/\[\s*cite_start\s*\]|\[\s*cite:\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "");
  // Clean up extra whitespace (multiple spaces, tabs, etc.)
  return cleaned
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main() {
  const yargsInstance: Argv<CliOptions> = yargs(Deno.args)
    .scriptName("cites.ts")
    .positional("text", {
      type: "string",
      describe: "Text to clean cite blocks from",
    })
    .usage("$0 [text]")
    .example('$0 "[cite_start]Hello world[cite: 42]"', "Clean cite blocks from text")
    .example("cat text.txt | $0", "Clean cite blocks from stdin")
    .help();

  const argv: ArgumentsCamelCase<CliOptions> = await yargsInstance.parseAsync();

  let text: string;
  // argv._ contains all positional args; we join them to support: cites.ts "some text"
  if (argv._.length > 0) {
    text = argv._.join(" ");
  } else {
    const stdinText = await new Response(Deno.stdin.readable).text();
    text = stdinText.trim();
    if (text === undefined || text === "") {
      yargsInstance.showHelp();
      Deno.exit(0);
    }
  }

  const cleaned = cleanCites(text);
  console.log(cleaned);
}

if (import.meta.main) {
  main();
}
