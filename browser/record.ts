#!/usr/bin/env -S deno run -A

/**
 * Headed session that records network traffic to a HAR file.
 * Use after logging in via browser/open.ts. Ctrl+C flushes the HAR.
 *
 *   deno run -A browser/record.ts https://example.com
 *   deno run -A browser/record.ts --out ./capture.har --filter <glob> https://example.com
 *
 * urlFilter is a Playwright glob and must match the full URL.
 * Use ** to cross `/` (a bare * does not) — for Instagram see README.
 *
 * Then summarize for client derivation:
 *   deno run -A browser/summarize.ts ./browser/hars/….har
 */

import {
  defaultHarPath,
  launch,
  pageOf,
  profileDir,
  untilInterrupt,
} from "./main.ts";

const args = Deno.args;
let out;
let filter;
const positional = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--out" || a === "-o") {
    out = args[++i];
    continue;
  }
  if (a === "--filter" || a === "-f") {
    filter = args[++i];
    continue;
  }
  if (a.startsWith("-")) {
    console.error(`unknown flag: ${a}`);
    Deno.exit(1);
  }
  positional.push(a);
}

const url = positional[0] ?? "https://example.com";
const harPath = out ?? defaultHarPath(
  (() => {
    try {
      return new URL(url).hostname.replaceAll(".", "-");
    } catch {
      return "capture";
    }
  })(),
);

const context = await launch({
  headless: false,
  recordHar: {
    path: harPath,
    content: "embed",
    mode: "full",
    ...(filter ? { urlFilter: filter } : {}),
  },
});
const page = await pageOf(context);

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log(`opened ${page.url()}`);
  console.log(`profile ${profileDir}`);
  console.log(`recording → ${harPath}`);
  if (filter) console.log(`filter ${filter}`);
  console.log("perform the flows you care about — Ctrl+C to save HAR");
  await untilInterrupt();
} finally {
  await context.close();
  console.log(`saved ${harPath}`);
  console.log(`next: deno run -A browser/summarize.ts ${harPath}`);
}
