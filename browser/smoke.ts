#!/usr/bin/env -S deno run -A

/**
 * Smoke test: open example.com with the persistent profile, print title, exit.
 * Closes the browser — use open.ts for an interactive headed session.
 */

import { launch, pageOf, profileDir } from "./main.ts";

const context = await launch({ headless: true });
const page = await pageOf(context);

try {
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
  console.log(await page.title());
  console.log(`profile ${profileDir}`);
} finally {
  await context.close();
}
