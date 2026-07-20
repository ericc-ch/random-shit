/**
 * Compare OpenCode Go usage estimates vs Nahcrof.
 *
 *   deno run --allow-net --allow-env web/pricing.tsx
 *
 * Optional: PORT=<n>
 */
import { Hono } from "@hono/hono";

type TokenUsage = { input: number; cached: number; output: number };

type ProviderOffer = {
  input: number;
  output: number;
  cachedRead?: number;
  label?: string;
  note?: string;
};

type Provider = {
  id: string;
  name: string;
  url: string;
  models: Record<string, ProviderOffer>;
};

type CanonicalModel = {
  id: string;
  family: string;
  name: string;
  baseUsage: TokenUsage;
};

type UsagePattern = {
  id: string;
  name: string;
  note: string;
  cachedMult: number;
  outputMult: number;
};

const USAGE_PATTERNS: UsagePattern[] = [
  {
    id: "opencode",
    name: "OpenCode baseline",
    note: "Published coding-agent estimates",
    cachedMult: 1,
    outputMult: 1,
  },
  {
    id: "intense",
    name: "Intense session",
    note: "Cached +50%, output +150%, input unchanged",
    cachedMult: 1.5,
    outputMult: 2.5,
  },
];

function usageForPattern(base: TokenUsage, pattern: UsagePattern): TokenUsage {
  return {
    input: base.input,
    cached: Math.round(base.cached * pattern.cachedMult),
    output: Math.round(base.output * pattern.outputMult),
  };
}

const OPENCODE_GO = {
  subscriptionMonthly: 10,
  limits: { fiveHour: 12, weekly: 30, monthly: 60 },
  url: "https://opencode.ai/docs/go/#usage-limits",
} as const;

const BASELINE = {
  id: "opencode-go",
  name: "OpenCode Go",
  url: OPENCODE_GO.url,
  models: {
    "glm-5.2": { input: 1.4, output: 4.4, cachedRead: 0.26 },
    "glm-5.1": { input: 1.4, output: 4.4, cachedRead: 0.26 },
    "kimi-k2.7-code": { input: 0.95, output: 4.0, cachedRead: 0.19 },
    "kimi-k2.6": { input: 0.95, output: 4.0, cachedRead: 0.16 },
    "mimo-v2.5": { input: 0.14, output: 0.28, cachedRead: 0.0028 },
    "mimo-v2.5-pro": { input: 1.74, output: 3.48, cachedRead: 0.0145 },
    "minimax-m3": { input: 0.3, output: 1.2, cachedRead: 0.06 },
    "minimax-m2.7": { input: 0.3, output: 1.2, cachedRead: 0.06 },
    "qwen3.7-max": { input: 2.5, output: 7.5, cachedRead: 0.5 },
    "qwen3.7-plus": { input: 0.4, output: 1.6, cachedRead: 0.04 },
    "qwen3.6-plus": { input: 0.5, output: 3.0, cachedRead: 0.05 },
    "deepseek-v4-pro": { input: 1.74, output: 3.48, cachedRead: 0.0145 },
    "deepseek-v4-flash": { input: 0.14, output: 0.28, cachedRead: 0.0028 },
  },
} satisfies Provider;

const PROVIDERS: Provider[] = [
  BASELINE,
  {
    id: "nahcrof",
    name: "Nahcrof (CrofAI)",
    url: "https://ai.nahcrof.com/pricing",
    models: {
      "glm-5.2": { input: 0.5, output: 2.2, cachedRead: 0.08 },
      "glm-5.1": { input: 0.45, output: 2.15, cachedRead: 0.08 },
      "kimi-k2.7-code": { input: 0.55, output: 2.25, cachedRead: 0.05 },
      "kimi-k2.6": { input: 0.5, output: 1.99, cachedRead: 0.05 },
      "mimo-v2.5-pro": { input: 0.4, output: 0.8, cachedRead: 0.003 },
      "minimax-m2.7": { input: 0.11, output: 0.95, cachedRead: 0.02, label: "minimax-m2.5", note: "M2.7 not listed; using m2.5" },
      "qwen3.7-max": { input: 0.35, output: 1.75, cachedRead: 0.07, label: "qwen3.5-397b-a17b", note: "3.7 Max not listed; using qwen3.5-397b-a17b" },
      "qwen3.7-plus": { input: 0.35, output: 1.75, cachedRead: 0.07, label: "qwen3.5-397b-a17b", note: "3.7 Plus not listed; using qwen3.5-397b-a17b" },
      "qwen3.6-plus": { input: 0.2, output: 1.5, cachedRead: 0.04, label: "qwen3.6-27b", note: "3.6 Plus not listed; using qwen3.6-27b" },
      "deepseek-v4-pro": { input: 0.35, output: 0.8, cachedRead: 0.003 },
      "deepseek-v4-flash": { input: 0.12, output: 0.21, cachedRead: 0.003 },
    },
  },
];

const CANONICAL: CanonicalModel[] = [
  { id: "glm-5.2", family: "GLM", name: "GLM-5.2", baseUsage: { input: 700, cached: 52_000, output: 150 } },
  { id: "glm-5.1", family: "GLM", name: "GLM-5.1", baseUsage: { input: 700, cached: 52_000, output: 150 } },
  { id: "kimi-k2.7-code", family: "Kimi", name: "Kimi K2.7 Code", baseUsage: { input: 870, cached: 55_000, output: 200 } },
  { id: "kimi-k2.6", family: "Kimi", name: "Kimi K2.6", baseUsage: { input: 870, cached: 55_000, output: 200 } },
  { id: "mimo-v2.5", family: "MiMo", name: "MiMo V2.5", baseUsage: { input: 830, cached: 71_500, output: 295 } },
  { id: "mimo-v2.5-pro", family: "MiMo", name: "MiMo V2.5 Pro", baseUsage: { input: 790, cached: 86_000, output: 305 } },
  { id: "minimax-m3", family: "MiniMax", name: "MiniMax M3", baseUsage: { input: 510, cached: 56_000, output: 190 } },
  { id: "minimax-m2.7", family: "MiniMax", name: "MiniMax M2.7", baseUsage: { input: 300, cached: 55_000, output: 125 } },
  { id: "qwen3.7-max", family: "Qwen", name: "Qwen3.7 Max", baseUsage: { input: 420, cached: 66_000, output: 200 } },
  { id: "qwen3.7-plus", family: "Qwen", name: "Qwen3.7 Plus", baseUsage: { input: 500, cached: 57_000, output: 190 } },
  { id: "qwen3.6-plus", family: "Qwen", name: "Qwen3.6 Plus", baseUsage: { input: 500, cached: 57_000, output: 190 } },
  { id: "deepseek-v4-pro", family: "DeepSeek", name: "DeepSeek V4 Pro", baseUsage: { input: 750, cached: 82_000, output: 290 } },
  { id: "deepseek-v4-flash", family: "DeepSeek", name: "DeepSeek V4 Flash", baseUsage: { input: 790, cached: 68_000, output: 280 } },
];

const FAMILIES = [...new Set(CANONICAL.map((m) => m.family))];

const PROVIDER_THEME = {
  "opencode-go": { color: "#6eb5e8", short: "Go" },
  nahcrof: { color: "#c49bff", short: "Nahcrof" },
} as const;

const FAMILY_COLORS: Record<string, string> = {
  GLM: "#d4845a",
  Kimi: "#8fb89a",
  MiMo: "#7eb8da",
  MiniMax: "#e8a87c",
  Qwen: "#b08cff",
  DeepSeek: "#6ec9c9",
};

function costPerRequest(usage: TokenUsage, offer: ProviderOffer) {
  const cacheRate = offer.cachedRead ?? offer.input;
  return (usage.input / 1e6) * offer.input +
    (usage.cached / 1e6) * cacheRate +
    (usage.output / 1e6) * offer.output;
}

function requestsInBudget(budget: number, cost: number) {
  if (cost <= 0) return Infinity;
  return Math.floor(budget / cost);
}

function fmtUsd(n: number, digits = 4) {
  if (!Number.isFinite(n)) return "—";
  if (n < 0.01 && n > 0) return `$${n.toFixed(digits)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtNum(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function fmtRate(n: number | undefined) {
  return n === undefined ? "—" : fmtUsd(n, n < 0.01 ? 4 : 2);
}

const SPEND_MONTHLY = OPENCODE_GO.subscriptionMonthly;
const GO_USAGE_CREDITS = OPENCODE_GO.limits.monthly;

const PROVIDER_BILLING = {
  "opencode-go": {
    outOfPocket: SPEND_MONTHLY,
    usageCredits: GO_USAGE_CREDITS,
  },
  nahcrof: {
    outOfPocket: SPEND_MONTHLY,
    usageCredits: SPEND_MONTHLY,
  },
} as const;

function ratioClassRequests(r: number) {
  if (r > 1.15) return "badge-ratio-good";
  if (r < 0.85) return "badge-ratio-bad";
  return "badge-ratio-neutral";
}

function ratioLabelRequests(r: number) {
  const pct = (r - 1) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${r.toFixed(2)}× ${sign}${pct.toFixed(0)}%`;
}

function buildComparison(pattern: UsagePattern) {
  return CANONICAL.map((model) => {
    const usage = usageForPattern(model.baseUsage, pattern);
    const providers = PROVIDERS.map((provider) => {
      const offer = provider.models[model.id as keyof typeof provider.models];
      if (!offer) return { providerId: provider.id, available: false as const };

      const costPerReq = costPerRequest(usage, offer);
      const billing = PROVIDER_BILLING[provider.id as keyof typeof PROVIDER_BILLING];
      const requestsForSpend = requestsInBudget(billing.usageCredits, costPerReq);
      return {
        providerId: provider.id,
        available: true as const,
        offer,
        costPerRequest: costPerReq,
        usageCredits: billing.usageCredits,
        requestsForSpend,
        outOfPocket: billing.outOfPocket,
        effectiveCostPerRequest: requestsForSpend > 0 ? billing.outOfPocket / requestsForSpend : null,
      };
    });

    const priced = providers.filter((p) => p.available);
    const go = priced.find((p) => p.providerId === "opencode-go");
    const goRequests = go?.requestsForSpend ?? null;

    let winnerId: string | null = null;
    let maxRequests = 0;
    for (const p of priced) {
      if (p.requestsForSpend > maxRequests) {
        maxRequests = p.requestsForSpend;
        winnerId = p.providerId;
      }
    }

    return {
      id: model.id,
      family: model.family,
      name: model.name,
      usage,
      patternId: pattern.id,
      goRequests,
      winnerId,
      maxRequests,
      providers: providers.map((p) => ({
        ...p,
        vsGoRequests: p.available && goRequests && goRequests > 0
          ? p.requestsForSpend / goRequests
          : null,
      })),
    };
  });
}

const COMPARISONS = Object.fromEntries(
  USAGE_PATTERNS.map((pattern) => [pattern.id, buildComparison(pattern)]),
);

type ComparisonRow = (typeof COMPARISONS)[string][0];
type ProviderRow = ComparisonRow["providers"][0];

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&display=swap");

:root {
  color-scheme: dark;
  --bg: #100f0d;
  --bg-elevated: #171513;
  --surface: #1e1c19;
  --surface-hover: #262320;
  --border: rgba(237, 228, 215, 0.09);
  --border-strong: rgba(237, 228, 215, 0.16);
  --text: #ede4d7;
  --muted: #9b9286;
  --dim: #6f6860;
  --copper: #d4845a;
  --sage: #8fb89a;
  --rose: #e07a7a;
  --gold: #e8c468;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --radius: 14px;
  --radius-sm: 9px;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  --font-display: "Instrument Serif", Georgia, serif;
  --font-body: "Manrope", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 50% at 12% -8%, rgba(212, 132, 90, 0.14), transparent 55%),
    radial-gradient(ellipse 60% 40% at 92% 8%, rgba(143, 184, 154, 0.1), transparent 50%),
    radial-gradient(ellipse 50% 30% at 50% 100%, rgba(110, 181, 232, 0.06), transparent 45%);
  pointer-events: none;
  z-index: 0;
}
body::after {
  content: "";
  position: fixed;
  inset: 0;
  opacity: 0.035;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 0;
}
a { color: var(--copper); text-decoration-thickness: 1px; text-underline-offset: 3px; }
a:hover { color: #e8a87c; }
a:focus-visible { outline: 2px solid var(--copper); outline-offset: 3px; border-radius: 2px; }
.skip {
  position: absolute;
  left: -9999px;
  top: 12px;
  z-index: 100;
  padding: 10px 16px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-weight: 600;
}
.skip:focus { left: 12px; }
.shell { position: relative; z-index: 1; max-width: 1480px; margin: 0 auto; padding: 32px 24px 80px; }
.hero {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 32px 48px;
  align-items: end;
  margin-bottom: 36px;
  padding-bottom: 32px;
  border-bottom: 1px solid var(--border);
}
@media (max-width: 900px) { .hero { grid-template-columns: 1fr; gap: 24px; } }
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.eyebrow::before { content: ""; width: 28px; height: 1px; background: var(--copper); }
h1 {
  margin: 0 0 16px;
  font-family: var(--font-display);
  font-size: clamp(2.4rem, 5vw, 3.6rem);
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: -0.02em;
}
h1 em { font-style: italic; color: var(--copper); }
.lead { margin: 0; max-width: 52ch; font-size: 1rem; color: var(--muted); }
.lead strong { color: var(--text); font-weight: 600; }
.hero-aside {
  background: linear-gradient(145deg, rgba(30, 28, 25, 0.95), rgba(23, 21, 19, 0.98));
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 22px 24px;
  box-shadow: var(--shadow);
}
.hero-aside p { margin: 0 0 12px; font-size: 0.88rem; color: var(--muted); line-height: 1.5; }
.hero-aside p:last-child { margin-bottom: 0; }
.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
@media (max-width: 760px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
.kpi {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
  transition: border-color 180ms var(--ease-out), background 180ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .kpi:hover { border-color: var(--border-strong); background: var(--surface-hover); }
}
.kpi-label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--dim);
}
.kpi-value { font-family: var(--font-mono); font-size: 1.5rem; font-weight: 500; letter-spacing: -0.03em; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.provider-legend { display: flex; flex-wrap: wrap; gap: 8px; }
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(30, 28, 25, 0.7);
  font-size: 0.78rem;
  color: var(--muted);
}
.legend-item a { color: inherit; text-decoration: none; }
@media (hover: hover) and (pointer: fine) {
  .legend-item:hover { border-color: var(--border-strong); color: var(--text); }
}
.legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; }
.filter-btn {
  appearance: none;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 7px 13px;
  border-radius: 999px;
  cursor: pointer;
  transition: color 140ms var(--ease-out), border-color 140ms var(--ease-out), background 140ms var(--ease-out), transform 100ms var(--ease-out);
}
.filter-btn:focus-visible { outline: 2px solid var(--copper); outline-offset: 2px; }
.filter-btn:active { transform: scale(0.97); }
.filter-btn[aria-pressed="true"] { color: var(--text); border-color: var(--border-strong); background: var(--surface); }
@media (hover: hover) and (pointer: fine) {
  .filter-btn:hover:not([aria-pressed="true"]) { color: var(--text); border-color: var(--border-strong); }
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
  padding: 4px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  width: fit-content;
  max-width: 100%;
}
.tab {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 10px 16px;
  border-radius: calc(var(--radius) - 4px);
  cursor: pointer;
  white-space: nowrap;
  transition: color 140ms var(--ease-out), background 140ms var(--ease-out), transform 100ms var(--ease-out);
}
.tab:focus-visible { outline: 2px solid var(--copper); outline-offset: -2px; }
.tab:active { transform: scale(0.97); }
.tab[aria-selected="true"] { color: var(--text); background: var(--surface); box-shadow: 0 1px 0 var(--border); }
@media (hover: hover) and (pointer: fine) {
  .tab:hover:not([aria-selected="true"]) { color: var(--text); }
}
.panel { display: none; }
.panel[data-active="true"] { display: block; }
.section-head { margin: 0 0 14px; }
.section-head h2 { margin: 0 0 6px; font-family: var(--font-display); font-size: 1.65rem; font-weight: 400; }
.section-head p { margin: 0; font-size: 0.9rem; color: var(--muted); max-width: 68ch; }
.table-wrap {
  overflow: auto;
  max-height: min(72vh, 820px);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(180deg, var(--surface) 0%, rgba(23, 21, 19, 0.98) 100%);
  box-shadow: var(--shadow);
}
table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.82rem; }
th, td { padding: 12px 14px; text-align: right; border-bottom: 1px solid var(--border); vertical-align: top; }
th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: #1c1a17;
  color: var(--dim);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}
th.col-model, td.col-model, th.col-family, td.col-family { text-align: left; }
th.col-family, td.col-family { position: sticky; left: 0; z-index: 2; background: #1c1a17; min-width: 88px; }
th.col-model, td.col-model { position: sticky; left: 88px; z-index: 2; background: #1c1a17; min-width: 150px; box-shadow: 4px 0 12px rgba(0, 0, 0, 0.2); }
td.col-family, td.col-model { background: var(--surface); }
@media (hover: hover) and (pointer: fine) {
  tbody tr:hover td { background: rgba(255, 255, 255, 0.02); }
  tbody tr:hover td.col-family, tbody tr:hover td.col-model { background: var(--surface-hover); }
}
th.provider-col { border-top: 3px solid var(--provider-color, var(--border)); }
tbody tr:last-child td { border-bottom: none; }
tbody tr[data-hidden="true"] { display: none; }
.family-tag { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--family-color, var(--muted)); }
.model-name { font-weight: 600; }
.na { color: var(--dim); font-family: var(--font-mono); }
.cell-budget { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; min-width: 140px; }
.budget-main { font-family: var(--font-mono); font-size: 1.05rem; font-weight: 600; letter-spacing: -0.02em; }
.req-bar { width: 100%; max-width: 120px; height: 5px; border-radius: 99px; background: rgba(255, 255, 255, 0.06); overflow: hidden; }
.req-bar > i { display: block; height: 100%; border-radius: 99px; opacity: 0.9; }
.budget-meta { font-size: 0.72rem; color: var(--muted); text-align: right; line-height: 1.35; }
.cell-cost { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; min-width: 130px; }
.cost-main { font-family: var(--font-mono); font-size: 0.88rem; font-weight: 500; }
.badge { display: inline-block; margin-top: 4px; padding: 2px 7px; border-radius: 4px; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.badge-win { background: rgba(143, 184, 154, 0.15); color: var(--sage); border: 1px solid rgba(143, 184, 154, 0.25); }
.badge-ratio-good { color: var(--sage); font-family: var(--font-mono); font-size: 0.72rem; }
.badge-ratio-bad { color: var(--rose); font-family: var(--font-mono); font-size: 0.72rem; }
.badge-ratio-neutral { color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem; }
.note { display: block; margin-top: 4px; font-size: 0.68rem; color: var(--gold); max-width: 26ch; white-space: normal; text-align: right; line-height: 1.35; }
.label { display: block; font-size: 0.66rem; color: var(--dim); max-width: 26ch; white-space: normal; text-align: right; line-height: 1.35; }
.mono { font-family: var(--font-mono); }
footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.82rem; }
footer p { margin: 0 0 10px; max-width: 72ch; }
footer code { font-family: var(--font-mono); font-size: 0.78rem; color: var(--text); background: var(--surface); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

const CLIENT_JS = `
(() => {
  const tabs = document.querySelectorAll('[role="tab"]');
  const panels = document.querySelectorAll('[role="tabpanel"]');
  const filters = document.querySelectorAll('.filter-btn[data-family]');
  const patternBtns = document.querySelectorAll('.pattern-btn');
  const rows = document.querySelectorAll('tbody tr[data-family]');

  function activePattern() {
    return document.querySelector('.pattern-btn[aria-pressed="true"]')?.dataset.pattern ?? 'opencode';
  }

  function activeTabKey() {
    const tab = document.querySelector('[role="tab"][aria-selected="true"]');
    return tab?.id.replace('tab-', '') ?? 'budget';
  }

  function applyView() {
    const pattern = activePattern();
    const tabKey = activeTabKey();
    panels.forEach((p) => {
      const panelTab = p.dataset.tab;
      const panelPattern = p.dataset.pattern;
      const show = panelTab === tabKey && (panelTab === 'rates' || panelPattern === pattern);
      p.setAttribute('data-active', String(show));
    });
    rows.forEach((row) => {
      const rowPattern = row.dataset.pattern;
      const familyHidden = row.getAttribute('data-family-hidden') === 'true';
      row.setAttribute('data-hidden', String(
        (rowPattern && rowPattern !== pattern) || familyHidden
      ));
    });
  }

  function selectTab(id) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.id === id)));
    applyView();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab.id));
    tab.addEventListener('keydown', (e) => {
      const list = [...tabs];
      const i = list.indexOf(tab);
      if (e.key === 'ArrowRight') { e.preventDefault(); const next = list[(i + 1) % list.length]; next.focus(); selectTab(next.id); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); const prev = list[(i - 1 + list.length) % list.length]; prev.focus(); selectTab(prev.id); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTab(tab.id); }
    });
  });

  patternBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      patternBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      applyView();
    });
  });

  filters.forEach((btn) => {
    btn.addEventListener('click', () => {
      const family = btn.dataset.family;
      filters.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.family === family)));
      rows.forEach((row) => {
        row.setAttribute('data-family-hidden', String(family !== 'all' && row.dataset.family !== family));
      });
      applyView();
    });
  });

  applyView();
})();
`;

function FamilyCell({ family, show }: { family: string; show: boolean }) {
  return (
    <td class="col-family">
      {show && (
        <span class="family-tag" style={{ "--family-color": FAMILY_COLORS[family] }}>
          {family}
        </span>
      )}
    </td>
  );
}

function BudgetCell({
  p,
  maxRequests,
  winnerId,
}: {
  p: ProviderRow;
  maxRequests: number;
  winnerId: string | null;
}) {
  if (!p.available) return <span class="na">—</span>;

  const theme = PROVIDER_THEME[p.providerId as keyof typeof PROVIDER_THEME];
  const barPct = maxRequests > 0 ? Math.max(4, (p.requestsForSpend / maxRequests) * 100) : 0;
  const pocketLabel = p.providerId === "opencode-go"
    ? `$${p.outOfPocket}/mo → $${p.usageCredits} credits`
    : `$${p.outOfPocket} PAYG`;

  return (
    <div class="cell-budget">
      <span class="budget-main">{fmtNum(p.requestsForSpend)}</span>
      <div class="req-bar" aria-hidden="true">
        <i style={{ width: `${barPct}%`, background: theme?.color }}></i>
      </div>
      <span class="budget-meta">requests for ${p.outOfPocket} spent</span>
      <span class="budget-meta">{pocketLabel}</span>
      {p.providerId !== "opencode-go" && p.vsGoRequests != null && (
        <span class={ratioClassRequests(p.vsGoRequests)}>{ratioLabelRequests(p.vsGoRequests)} vs Go</span>
      )}
      {winnerId === p.providerId && <span class="badge badge-win">Most</span>}
      {p.offer.label && <span class="label">{p.offer.label}</span>}
      {p.offer.note && <span class="note">{p.offer.note}</span>}
    </div>
  );
}

function CostCell({ p }: { p: ProviderRow }) {
  if (!p.available || p.effectiveCostPerRequest == null) return <span class="na">—</span>;

  return (
    <div class="cell-cost">
      <span class="cost-main">{fmtUsd(p.effectiveCostPerRequest, 4)}</span>
      <span class="budget-meta">per request</span>
      <span class="budget-meta">
        {p.providerId === "opencode-go"
          ? `$${p.outOfPocket}/mo → $${p.usageCredits} of usage`
          : `$${p.outOfPocket} cash → $${p.usageCredits} of usage`}
      </span>
    </div>
  );
}

function PatternPanels({ pattern, rows }: { pattern: UsagePattern; rows: ComparisonRow[] }) {
  const active = pattern.id === USAGE_PATTERNS[0].id;

  return (
    <>
      <section
        class="panel"
        role="tabpanel"
        data-pattern={pattern.id}
        data-tab="budget"
        data-active={active ? "true" : "false"}
        aria-labelledby="tab-budget"
      >
        <div class="section-head">
          <h2>Requests for ${SPEND_MONTHLY}/mo</h2>
          <p>
            {pattern.note}. Go on ${GO_USAGE_CREDITS} of credits, Nahcrof on ${SPEND_MONTHLY} of PAYG usage.
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-family" scope="col">Family</th>
                <th class="col-model" scope="col">Model</th>
                {PROVIDERS.map((p) => (
                  <th key={p.id} class="provider-col" scope="col" style={{ "--provider-color": PROVIDER_THEME[p.id as keyof typeof PROVIDER_THEME]?.color }}>
                    {PROVIDER_THEME[p.id as keyof typeof PROVIDER_THEME]?.short ?? p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} data-family={row.family} data-pattern={pattern.id}>
                  <FamilyCell family={row.family} show={i === 0 || rows[i - 1].family !== row.family} />
                  <td class="col-model"><span class="model-name">{row.name}</span></td>
                  {row.providers.map((p) => (
                    <td key={p.providerId}>
                      <BudgetCell p={p} maxRequests={row.maxRequests} winnerId={row.winnerId} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        class="panel"
        role="tabpanel"
        data-pattern={pattern.id}
        data-tab="cost"
        data-active="false"
        aria-labelledby="tab-cost"
      >
        <div class="section-head">
          <h2>Cost per request</h2>
          <p>
            {pattern.note}. ${SPEND_MONTHLY} out of pocket divided by the requests above.
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-family" scope="col">Family</th>
                <th class="col-model" scope="col">Model</th>
                {PROVIDERS.map((p) => (
                  <th key={p.id} class="provider-col" scope="col" style={{ "--provider-color": PROVIDER_THEME[p.id as keyof typeof PROVIDER_THEME]?.color }}>
                    {PROVIDER_THEME[p.id as keyof typeof PROVIDER_THEME]?.short ?? p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} data-family={row.family} data-pattern={pattern.id}>
                  <FamilyCell family={row.family} show={i === 0 || rows[i - 1].family !== row.family} />
                  <td class="col-model"><span class="model-name">{row.name}</span></td>
                  {row.providers.map((p) => (
                    <td key={p.providerId}>
                      <CostCell p={p} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        class="panel"
        role="tabpanel"
        data-pattern={pattern.id}
        data-tab="usage"
        data-active="false"
        aria-labelledby="tab-usage"
      >
        <div class="section-head">
          <h2>Usage pattern</h2>
          <p>{pattern.note}</p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="col-family" scope="col">Family</th>
                <th class="col-model" scope="col">Model</th>
                <th scope="col">Input</th>
                <th scope="col">Cached</th>
                <th scope="col">Output</th>
                <th scope="col">Go req @ ${GO_USAGE_CREDITS}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} data-family={row.family} data-pattern={pattern.id}>
                  <FamilyCell family={row.family} show={i === 0 || rows[i - 1].family !== row.family} />
                  <td class="col-model"><span class="model-name">{row.name}</span></td>
                  <td class="mono">{fmtNum(row.usage.input)}</td>
                  <td class="mono">{fmtNum(row.usage.cached)}</td>
                  <td class="mono">{fmtNum(row.usage.output)}</td>
                  <td class="mono">{row.goRequests != null ? fmtNum(row.goRequests) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function RatesPanel() {
  const rows = COMPARISONS[USAGE_PATTERNS[0].id];

  return (
    <section
      class="panel"
      role="tabpanel"
      data-tab="rates"
      data-active="false"
      aria-labelledby="tab-rates"
    >
      <div class="section-head">
        <h2>Token rates</h2>
        <p>Published $/1M tokens — input, cache read, and output.</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-family" scope="col">Family</th>
              <th class="col-model" scope="col">Model</th>
              {PROVIDERS.map((p) => (
                <th key={p.id} colspan={3} scope="colgroup" class="provider-col" style={{ "--provider-color": PROVIDER_THEME[p.id as keyof typeof PROVIDER_THEME]?.color }}>
                  {PROVIDER_THEME[p.id as keyof typeof PROVIDER_THEME]?.short ?? p.name}
                </th>
              ))}
            </tr>
            <tr>
              <th class="col-family" scope="col"></th>
              <th class="col-model" scope="col"></th>
              {PROVIDERS.flatMap((p) => [
                <th key={`${p.id}-in`} scope="col">In</th>,
                <th key={`${p.id}-cache`} scope="col">Cache</th>,
                <th key={`${p.id}-out`} scope="col">Out</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id} data-family={row.family}>
                <FamilyCell family={row.family} show={i === 0 || rows[i - 1].family !== row.family} />
                <td class="col-model"><span class="model-name">{row.name}</span></td>
                {row.providers.flatMap((p) =>
                  !p.available
                    ? [
                      <td key={`${p.providerId}-in`} class="na">—</td>,
                      <td key={`${p.providerId}-cache`} class="na">—</td>,
                      <td key={`${p.providerId}-out`} class="na">—</td>,
                    ]
                    : [
                      <td key={`${p.providerId}-in`} class="mono">{fmtRate(p.offer.input)}</td>,
                      <td key={`${p.providerId}-cache`} class="mono">{fmtRate(p.offer.cachedRead)}</td>,
                      <td key={`${p.providerId}-out`} class="mono">{fmtRate(p.offer.output)}</td>,
                    ]
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#100f0d" />
        <meta name="description" content="Compare what $10/month actually gets you on OpenCode Go vs Nahcrof." />
        <title>$10 spend compare — OpenCode Go vs Nahcrof</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <a class="skip" href="#main">Skip to comparison</a>

        <div class="shell">
          <header class="hero">
            <div>
              <p class="eyebrow">${SPEND_MONTHLY}/month spend</p>
              <h1>
                What does <em>${SPEND_MONTHLY}</em> get you?
              </h1>
              <p class="lead">
                You spend <strong>${SPEND_MONTHLY}/mo</strong> either way. OpenCode Go turns that into{" "}
                <strong>${GO_USAGE_CREDITS}</strong> of usage credits. Nahcrof is pay-as-you-go —{" "}
                <strong>${SPEND_MONTHLY}</strong> cash buys <strong>${SPEND_MONTHLY}</strong> of tokens.
                Same coding-agent token mix as{" "}
                <a href={OPENCODE_GO.url} target="_blank" rel="noopener noreferrer">OpenCode Go docs</a>.
              </p>
            </div>
            <aside class="hero-aside" aria-label="How to read this">
              <p>
                <strong style="color:var(--text)">Main number</strong> is requests you get for what you
                actually pay — ${SPEND_MONTHLY}/mo on each side.
              </p>
              <p>
                Go: ${SPEND_MONTHLY} → ${GO_USAGE_CREDITS} credits. Nahcrof: ${SPEND_MONTHLY} → ${SPEND_MONTHLY} usage.
                Green ratios mean more requests than Go at the same wallet spend.
              </p>
              <p>
                Raw data: <a href="/api/compare.json">/api/compare.json</a>
              </p>
            </aside>
          </header>

          <div class="kpi-grid" aria-label="Pricing model">
            <div class="kpi">
              <span class="kpi-label">OpenCode Go</span>
              <span class="kpi-value">${SPEND_MONTHLY} → ${GO_USAGE_CREDITS}</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">Nahcrof</span>
              <span class="kpi-value">${SPEND_MONTHLY} PAYG</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">Your spend</span>
              <span class="kpi-value">${SPEND_MONTHLY}/mo</span>
            </div>
            <div class="kpi">
              <span class="kpi-label">Models tracked</span>
              <span class="kpi-value">{CANONICAL.length}</span>
            </div>
          </div>

          <div class="toolbar">
            <div class="provider-legend" aria-label="Providers">
              {PROVIDERS.map((p) => (
                <span class="legend-item" key={p.id}>
                  <span class="legend-dot" style={{ background: PROVIDER_THEME[p.id as keyof typeof PROVIDER_THEME]?.color }}></span>
                  <a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
                </span>
              ))}
            </div>
            <div class="filters" role="group" aria-label="Usage pattern">
              {USAGE_PATTERNS.map((pattern, i) => (
                <button
                  type="button"
                  class="filter-btn pattern-btn"
                  data-pattern={pattern.id}
                  aria-pressed={i === 0 ? "true" : "false"}
                  key={pattern.id}
                >
                  {pattern.name}
                </button>
              ))}
            </div>
            <div class="filters" role="group" aria-label="Filter by model family">
              <button type="button" class="filter-btn" data-family="all" aria-pressed="true">All</button>
              {FAMILIES.map((f) => (
                <button type="button" class="filter-btn" data-family={f} aria-pressed="false" key={f}>{f}</button>
              ))}
            </div>
          </div>

          <nav class="tabs" role="tablist" aria-label="Comparison views">
            <button type="button" class="tab" role="tab" id="tab-budget" aria-selected="true" aria-controls="panel-budget">${SPEND_MONTHLY} spend</button>
            <button type="button" class="tab" role="tab" id="tab-cost" aria-selected="false" aria-controls="panel-cost">$/request</button>
            <button type="button" class="tab" role="tab" id="tab-rates" aria-selected="false" aria-controls="panel-rates">Token rates</button>
            <button type="button" class="tab" role="tab" id="tab-usage" aria-selected="false" aria-controls="panel-usage">Usage pattern</button>
          </nav>

          <main id="main">
            {USAGE_PATTERNS.map((pattern) => (
              <PatternPanels key={pattern.id} pattern={pattern} rows={COMPARISONS[pattern.id]} />
            ))}
            <RatesPanel />
          </main>

          <footer>
            <p>
              Extend by appending to <code>PROVIDERS</code> in <code>pricing.tsx</code> using
              the same canonical model ids.
            </p>
          </footer>
        </div>

        <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }} />
      </body>
    </html>
  );
}

const portEnv = Deno.env.get("PORT");
const parsedPort = portEnv === undefined || portEnv === "" ? 0 : Number(portEnv);
const listenPort = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 0;

const app = new Hono();

app.use(async (c, next) => {
  if (c.req.method !== "GET") return c.text("Method not allowed", 405);
  await next();
});

app.get("/", (c) => c.html(<ComparisonPage />));
app.get("/index.html", (c) => c.html(<ComparisonPage />));
app.get("/api/compare.json", (c) =>
  c.json({
    opencodeGo: OPENCODE_GO,
    spendMonthly: SPEND_MONTHLY,
    patterns: USAGE_PATTERNS,
    comparisons: COMPARISONS,
  }, 200, { "cache-control": "no-store" })
);
app.notFound((c) => c.text("Not found", 404));

const server = Deno.serve({ port: listenPort }, app.fetch);
console.error(`Pricing compare → http://127.0.0.1:${server.addr.port}/`);
