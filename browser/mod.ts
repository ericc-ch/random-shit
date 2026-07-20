import { join } from "jsr:@std/path@1";
import { chromium } from "patchright";

export { chromium };

const browserDir = import.meta.dirname!;

/** Persistent Chrome user-data dir owned by this package. */
export const profileDir = join(browserDir, "profile");

const which = async (bin: string) => {
  const command = new Deno.Command("sh", {
    args: ["-c", `command -v ${bin}`],
    stdout: "piped",
    stderr: "null",
  });
  const { code, stdout } = await command.output();
  if (code !== 0) return;
  const path = new TextDecoder().decode(stdout).trim();
  return path || undefined;
};

/** Prefer real Chrome, then Chromium, then an explicit executable. */
export const resolveExecutable = async () => {
  const fromEnv = Deno.env.get("BROWSER_EXECUTABLE") ??
    Deno.env.get("CHROMIUM_PATH") ??
    Deno.env.get("CHROME_PATH");
  if (fromEnv) return fromEnv;

  for (
    const bin of [
      "google-chrome-stable",
      "google-chrome",
      "chromium",
      "chromium-browser",
    ]
  ) {
    const path = await which(bin);
    if (path) return path;
  }
};

export const launchOptions = async (overrides: {
  headless?: boolean;
  executablePath?: string;
  channel?: string;
} = {}) => {
  const executablePath = overrides.executablePath ?? await resolveExecutable();
  const channel = overrides.channel ?? Deno.env.get("BROWSER_CHANNEL");

  return {
    headless: overrides.headless ?? false,
    viewport: null,
    // System/env binary wins. Otherwise Patchright's installed Chromium.
    // Set BROWSER_CHANNEL=chrome when you have real Google Chrome (stealthier).
    ...(executablePath
      ? { executablePath }
      : channel
      ? { channel }
      : {}),
  };
};

/**
 * Launch Patchright with the local persistent profile under browser/profile.
 * Cookies, logins, and extensions survive across runs.
 */
export const launch = async (overrides: {
  headless?: boolean;
  executablePath?: string;
  channel?: string;
} = {}) => {
  await Deno.mkdir(profileDir, { recursive: true });
  const options = await launchOptions(overrides);
  return chromium.launchPersistentContext(profileDir, options);
};

/** First page in the persistent context (creates one if needed). */
export const pageOf = async (context: Awaited<ReturnType<typeof launch>>) =>
  context.pages()[0] ?? await context.newPage();
