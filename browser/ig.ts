#!/usr/bin/env -S deno run -A

/**
 * Fetch Instagram post payload via live response intercept
 * (same approach as skripsi-sheila — HAR often omits /media/.../info/ bodies).
 *
 * Needs a logged-in browser/profile (browser/open.ts https://www.instagram.com/).
 *
 *   nix develop -c deno run -A browser/ig.ts https://www.instagram.com/p/SHORTCODE/
 *   nix develop -c deno run -A browser/ig.ts --profile https://www.instagram.com/gaston.indo/ --limit 3
 */

import type { Page } from "patchright";
import { launch, pageOf } from "./main.ts";

const isMediaInfo = (url: string) =>
  url.includes("/api/v1/media/") && url.includes("/info/");

const waitMediaInfo = (page: Page, timeoutMs = 15000) =>
  page.waitForResponse(
    (res) => isMediaInfo(res.url()) && res.ok(),
    { timeout: timeoutMs },
  );

/** Click a profile grid post and return the /media/.../info/ JSON. */
export const fetchPostFromProfile = async (
  page: Page,
  shortcodeOrHref: string,
) => {
  const shortcode = shortcodeOrHref.includes("/")
    ? (shortcodeOrHref.match(/\/(p|reel)\/([^/?#]+)/)?.[2] ?? shortcodeOrHref)
    : shortcodeOrHref;

  const anchor = page.locator(
    `a[href*="/p/${shortcode}"], a[href*="/reel/${shortcode}"]`,
  ).first();

  await anchor.scrollIntoViewIfNeeded();
  const infoPromise = waitMediaInfo(page);
  await anchor.evaluate((el) => el.click());
  const res = await infoPromise;
  const json = await res.json();

  await page.keyboard.press("Escape").catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  return json;
};

/** Open a post URL directly and intercept /media/.../info/. */
export const fetchPostByUrl = async (page: Page, postUrl: string) => {
  const infoPromise = waitMediaInfo(page, 20000);
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  const res = await infoPromise.catch(() => null);
  if (res) return await res.json();

  // Some layouts only fire info after the media is focused — try clicking the post.
  const post = page.locator('a[href*="/p/"], a[href*="/reel/"], article').first();
  const retry = waitMediaInfo(page);
  await post.click({ timeout: 5000 }).catch(() => {});
  const res2 = await retry;
  return await res2.json();
};

const summarizeItem = (item: Record<string, unknown>) => {
  const captionObj = item.caption as { text?: string } | null | undefined;
  const user = item.user as { username?: string } | undefined;
  return {
    id: item.id,
    code: item.code,
    username: user?.username,
    taken_at: item.taken_at,
    like_count: item.like_count,
    comment_count: item.comment_count,
    caption: captionObj?.text ?? "",
    media_type: item.media_type,
  };
};

const args = Deno.args.filter((a) => a !== "--");
let asProfile = false;
let limit = 1;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--profile") {
    asProfile = true;
    continue;
  }
  if (a === "--limit") {
    limit = Number(args[++i] ?? 1);
    continue;
  }
  if (a.startsWith("-")) {
    console.error(`unknown flag: ${a}`);
    Deno.exit(1);
  }
  positional.push(a);
}
const url = positional[0];
if (!url) {
  console.error(
    "usage:\n  browser/ig.ts <post-url>\n  browser/ig.ts --profile <profile-url> [--limit N]",
  );
  Deno.exit(1);
}

const context = await launch({ headless: true });
const page = await pageOf(context);

try {
  if (asProfile || (!url.includes("/p/") && !url.includes("/reel/"))) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    if (page.url().includes("/accounts/login")) {
      console.error(
        "not logged in — run: nix develop -c deno run -A browser/open.ts https://www.instagram.com/",
      );
      Deno.exit(1);
    }

    const hrefs = await page.locator('a[href*="/p/"], a[href*="/reel/"]').evaluateAll(
      (els) => [...new Set(els.map((el) => (el as { href: string }).href))],
    );
    const pick = hrefs.slice(0, Math.max(1, limit));
    console.log(`profile posts ${hrefs.length}, fetching ${pick.length}`);

    const out = [];
    for (const href of pick) {
      const json = await fetchPostFromProfile(page, href);
      const item = (json.items?.[0] ?? json) as Record<string, unknown>;
      out.push(summarizeItem(item));
    }
    console.log(JSON.stringify(out, null, 2));
  } else {
    await page.goto("https://www.instagram.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    if (page.url().includes("/accounts/login")) {
      console.error(
        "not logged in — run: nix develop -c deno run -A browser/open.ts https://www.instagram.com/",
      );
      Deno.exit(1);
    }
    const json = await fetchPostByUrl(page, url);
    const item = (json.items?.[0] ?? json) as Record<string, unknown>;
    console.log(JSON.stringify(summarizeItem(item), null, 2));
  }
} finally {
  await context.close();
}
