#!/usr/bin/env -S deno run -A

/**
 * Summarize a HAR into API-shaped calls for deriving a lightweight HTTP client.
 *
 *   deno task browser:summarize -- ./browser/hars/….har
 *   deno task browser:summarize -- --json ./browser/hars/….har
 */

import { summarizeHar } from "./main.ts";

const json = Deno.args.includes("--json");
const harPath = Deno.args.find((a) => !a.startsWith("-"));

if (!harPath) {
  console.error("usage: deno task browser:summarize -- [--json] <file.har>");
  Deno.exit(1);
}

const summary = await summarizeHar(harPath);

if (json) {
  console.log(JSON.stringify(summary, null, 2));
  Deno.exit(0);
}

console.log(
  `${summary.apiCalls.length} API-ish endpoints (${summary.totalEntries} total entries)`,
);
console.log(`har ${summary.harPath}\n`);

for (const call of summary.apiCalls) {
  console.log(
    `${call.response?.status ?? "?"}  ${call.method}  ${call.url}`,
  );
  const query = call.request?.queryString;
  if (query?.length) {
    const parts = [];
    for (const q of query) parts.push(`${q.name}=${q.value}`);
    console.log(`    query  ${parts.join("&")}`);
  }
  const rawBody = call.request?.postData?.text;
  if (rawBody) {
    const one = rawBody.replaceAll("\n", " ");
    console.log(
      `    body   ${one.length > 160 ? `${one.slice(0, 157)}...` : one}`,
    );
  }
  const mime = call.response?.content?.mimeType;
  if (mime) console.log(`    resp   ${mime}`);
  if (call.count > 1) console.log(`    ×${call.count}`);
  console.log();
}
