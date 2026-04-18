#!/usr/bin/env -S deno run -A

// @deno-types="npm:@types/yargs@17"
import yargs from "npm:yargs@18";
import type { ArgumentsCamelCase, Argv } from "npm:@types/yargs@17";

interface CliOptions {
  locale: string;
  text?: string;
}

async function main() {
  const yargsInstance: Argv<CliOptions> = yargs(Deno.args)
    .scriptName("wordcount.ts")
    .option("locale", {
      alias: "l",
      type: "string",
      default: "en",
      describe: "Locale for word segmentation",
    })
    .positional("text", {
      type: "string",
      describe: "Text to count words in",
    })
    .usage("$0 [text] [options]")
    .example('$0 "Hello world" -l en', 'Count words in "Hello world"')
    .example('echo "Hello world" | $0 -l en', "Count words from stdin")
    .help();

  const argv: ArgumentsCamelCase<CliOptions> = await yargsInstance.parseAsync();

  let text: string;
  // argv._ contains all positional args; we join them to support: wordcount.ts Hello world
  if (argv._.length > 0) {
    text = argv._.join(" ");
  } else {
    const stdinText = await new Response(Deno.stdin.readable).text();
    text = stdinText.trim();
    if (text === undefined) {
      yargsInstance.showHelp();
      Deno.exit(0);
    }
  }

  const segmenter = new Intl.Segmenter(argv.locale, { granularity: "word" });
  const segments = Array.from(segmenter.segment(text));

  const wordCount = segments.filter((s) => s.isWordLike).length;

  console.log(wordCount);
}

if (import.meta.main) {
  main();
}
