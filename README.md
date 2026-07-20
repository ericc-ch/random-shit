## cli/

- **wordcount.ts** — Count words in text using `Intl.Segmenter`
- **cites.ts** — Strip `[cite_start]` / `[cite: N]` markers from text
- **refs.ts** — Shallow-clone reference repos into `/tmp/references`

## web/

- **cursor.tsx** — Cursor projects analytics dashboard
- **opencode.tsx** — OpenCode SQLite analytics dashboard
- **pricing.tsx** — OpenCode Go vs Nahcrof pricing compare
- **cookies.ts** — httpbin-style `/cookies` with a random id cookie
- **gemma.ts** — Handy → Gemini proxy that fixes Gemma thinking fields
- **mermaid.html** — Mermaid editor / HD PNG exporter
- **pdf.html** — PDF → PNG converter

## browser/

Persistent Chrome profile + Patchright helpers (`open`, `record`, `smoke`, `summarize`).
