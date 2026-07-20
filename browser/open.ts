#!/usr/bin/env -S deno run -A

/**
 * Headed session with the persistent profile — log in, click around, Ctrl+C to exit.
 * Cookies survive for later headless / record runs.
 *
 *   deno task browser:open -- https://example.com
 */

import { launch, pageOf, profileDir, untilInterrupt } from "./main.ts";

const url = Deno.args[0] ?? "https://example.com";

const context = await launch({ headless: false });
const page = await pageOf(context);

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log(`opened ${page.url()}`);
  console.log(`profile ${profileDir}`);
  console.log("log in / browse freely — Ctrl+C when done");
  await untilInterrupt();
} finally {
  await context.close();
  console.log("closed");
}
