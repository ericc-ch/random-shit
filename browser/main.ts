import { dirname, join } from "@std/path";
import { chromium } from "patchright";

export { chromium };

const browserDir = import.meta.dirname!;

/** Persistent Chrome user-data dir owned by this package. */
export const profileDir = join(browserDir, "profile");

/** Default dir for recorded HAR captures (gitignored — often contains auth). */
export const harDir = join(browserDir, "hars");

/** Prefer Helium, then Chrome/Chromium, then an explicit executable. */
export const resolveExecutable = async () => {
  const fromEnv = Deno.env.get("BROWSER_EXECUTABLE") ??
    Deno.env.get("CHROMIUM_PATH") ??
    Deno.env.get("CHROME_PATH");
  if (fromEnv) return fromEnv;

  for (
    const bin of [
      "helium",
      "google-chrome-stable",
      "google-chrome",
      "chromium",
      "chromium-browser",
    ]
  ) {
    const command = new Deno.Command("sh", {
      args: ["-c", `command -v ${bin}`],
      stdout: "piped",
      stderr: "null",
    });
    const { code, stdout } = await command.output();
    if (code !== 0) continue;
    const path = new TextDecoder().decode(stdout).trim();
    if (path) return path;
  }
};

/**
 * Launch Patchright with the local persistent profile under browser/profile.
 * Cookies, logins, and extensions survive across runs.
 * Pass `recordHar` to capture network traffic (flushed on context.close()).
 */
export const launch = async (overrides: {
  headless?: boolean;
  executablePath?: string;
  channel?: string;
  recordHar?: {
    path: string;
    content?: "omit" | "embed" | "attach";
    mode?: "full" | "minimal";
    urlFilter?: string | RegExp;
    omitContent?: boolean;
  };
} = {}) => {
  await Deno.mkdir(profileDir, { recursive: true });
  if (overrides.recordHar) {
    await Deno.mkdir(dirname(overrides.recordHar.path), { recursive: true });
  }

  const executablePath = overrides.executablePath ?? await resolveExecutable();
  const channel = overrides.channel ?? Deno.env.get("BROWSER_CHANNEL");

  return chromium.launchPersistentContext(profileDir, {
    headless: overrides.headless ?? false,
    viewport: null,
    // System/env binary wins. Otherwise Patchright's installed Chromium.
    // Set BROWSER_CHANNEL=chrome when you have real Google Chrome (stealthier).
    ...(executablePath
      ? { executablePath }
      : channel
      ? { channel }
      : {}),
    ...(overrides.recordHar ? { recordHar: overrides.recordHar } : {}),
  });
};

/** First page in the persistent context (creates one if needed). */
export const pageOf = async (context: Awaited<ReturnType<typeof launch>>) =>
  context.pages()[0] ?? await context.newPage();

/** Resolve once on Ctrl+C / SIGTERM so headed sessions can flush HAR and exit. */
export const untilInterrupt = () =>
  new Promise((resolve) => {
    const stop = () => {
      try {
        Deno.removeSignalListener("SIGINT", stop);
        Deno.removeSignalListener("SIGTERM", stop);
      } catch {
        // already removed
      }
      resolve(undefined);
    };
    Deno.addSignalListener("SIGINT", stop);
    Deno.addSignalListener("SIGTERM", stop);
  });

/** Timestamped path under browser/hars/. */
export const defaultHarPath = (label = "capture") => {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return join(harDir, `${label}-${stamp}.har`);
};

/**
 * HAR → deduped API-shaped calls for deriving HTTP clients.
 * Keeps raw request/response; filters static assets. Display truncation belongs in CLIs.
 */
export const summarizeHar = async (harPath: string) => {
  const har = JSON.parse(await Deno.readTextFile(harPath));
  const entries = har.log?.entries ?? [];
  const byKey = new Map();

  for (const entry of entries) {
    const type = entry._resourceType ?? "";
    const mime = entry.response?.content?.mimeType ?? "";
    const method = entry.request?.method ?? "GET";
    const interesting = type === "xhr" || type === "fetch" ||
      type === "websocket" || mime.includes("json") ||
      mime.includes("graphql") ||
      (method !== "GET" && method !== "OPTIONS");
    if (!interesting) continue;

    const url = entry.request?.url;
    if (!url) continue;

    let key = `${method} ${url}`;
    try {
      const u = new URL(url);
      key = `${method} ${u.origin}${u.pathname}`;
    } catch {
      // keep raw url key
    }

    const prev = byKey.get(key);
    if (prev) {
      prev.count += 1;
      continue;
    }

    byKey.set(key, {
      method,
      url,
      count: 1,
      resourceType: entry._resourceType,
      request: entry.request,
      response: entry.response,
    });
  }

  return {
    harPath,
    totalEntries: entries.length,
    apiCalls: [...byKey.values()],
  };
};
