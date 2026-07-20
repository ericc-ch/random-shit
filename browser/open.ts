#!/usr/bin/env -S deno run -A

import { launch, pageOf, profileDir } from "./mod.ts";

const url = Deno.args[0] ?? "https://example.com";

const context = await launch();
const page = await pageOf(context);

await page.goto(url, { waitUntil: "domcontentloaded" });
console.log(`opened ${page.url()}`);
console.log(`profile ${profileDir}`);

// Keep the headed browser open until Ctrl+C.
await new Promise(() => {});
