Use Deno.
After completing a task that touches Deno TypeScript, run `deno check` and `deno lint`.

Never explicitly write types unless needed. Prefer type inference.

# Browser automation

All browser automation lives under `browser/`.

- Use Patchright (`import { launch, pageOf, chromium } from "./browser/mod.ts"`).
- Persistent profile: `browser/profile/` (gitignored). Prefer this over ephemeral contexts.
- On Nix, launch from `nix develop` / `nix shell nixpkgs#chromium` so `BROWSER_EXECUTABLE` points at nixpkgs Chromium. Bundled Playwright Chromium will not start (missing libs).
- Install driver browsers (optional, for non-Nix): `deno task browser:install`
- Smoke: `deno task browser:smoke`
- Headed session: `deno task browser:open -- https://example.com`

Write Playwright-style scripts (one-shot code), not click/scroll action loops.

# References Directory

The `/tmp/references/` directory contains shallow clones of important external repositories.
Never make any changes in this directory, it is meant as reference only.

Prefer exploring and reading this directory over searching for documentation. Think of it as the source of truth.

Available references:

- effect - Effect v4
- opencode - OpenCode
