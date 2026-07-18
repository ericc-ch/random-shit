/**
 * Local OpenAI-compat proxy for Handy → Google Gemini API.
 *
 * Handy Custom always sends reasoning_effort: "none". Google's OpenAI layer
 * maps that to thinking_budget, which Gemma rejects with:
 *   "Thinking budget is not supported for this model."
 *
 * This proxy strips / remaps reasoning fields for Gemma, then forwards.
 *
 * Point Handy Custom base URL at:
 *   http://127.0.0.1:8787/v1beta/openai
 */

const UPSTREAM =
  Deno.env.get("UPSTREAM") ??
  "https://generativelanguage.googleapis.com";
const PORT = Number(Deno.env.get("PORT") ?? "8787");
const HOST = Deno.env.get("HOST") ?? "127.0.0.1";

/**
 * Gemma 4 supports thinking_level MINIMAL | HIGH (not thinking_budget).
 * MINIMAL is the lowest; default so Handy requests spend less on thought tokens.
 * Set GEMMA_THINKING_LEVEL= to disable injection (strip-only).
 */
const GEMMA_THINKING_LEVEL = Deno.env.get("GEMMA_THINKING_LEVEL") ?? "MINIMAL";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function isGemmaModel(model: unknown): boolean {
  if (typeof model !== "string") return false;
  return /gemma/i.test(model);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Ensure extra_body.google.thinking_config.thinking_level exists. */
function setGemmaThinkingLevel(
  body: Record<string, unknown>,
  level: string,
): void {
  const extraBody = asRecord(body.extra_body) ?? {};
  const google = asRecord(extraBody.google) ?? {};
  const thinkingConfig = asRecord(google.thinking_config) ?? {};

  thinkingConfig.thinking_level = level;
  google.thinking_config = thinkingConfig;
  extraBody.google = google;
  body.extra_body = extraBody;
}

/**
 * Transform chat-completion JSON for Gemma compatibility.
 * Returns whether anything changed.
 */
export function transformChatBody(body: Record<string, unknown>): boolean {
  if (!isGemmaModel(body.model)) return false;

  let changed = false;

  if ("reasoning_effort" in body) {
    delete body.reasoning_effort;
    changed = true;
  }

  // Google sometimes accepts these on OpenAI-compat; Gemma rejects budget.
  if ("thinking_budget" in body) {
    delete body.thinking_budget;
    changed = true;
  }

  const extraBody = asRecord(body.extra_body);
  const google = extraBody ? asRecord(extraBody.google) : null;
  const thinkingConfig = google ? asRecord(google.thinking_config) : null;
  if (thinkingConfig && "thinking_budget" in thinkingConfig) {
    delete thinkingConfig.thinking_budget;
    changed = true;
  }

  if (GEMMA_THINKING_LEVEL) {
    setGemmaThinkingLevel(body, GEMMA_THINKING_LEVEL);
    changed = true;
  }

  return changed;
}

/** Strip Gemma / Gemini thought channels embedded in assistant text. */
export function stripThinkingFromContent(content: string): string {
  let out = content;

  // Named XML-ish blocks Gemma often dumps into content.
  out = out.replace(/<thought\b[^>]*>[\s\S]*?<\/thought>/gi, "");
  out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "");

  // Unclosed leading thought block (model truncated mid-think).
  out = out.replace(/<thought\b[^>]*>[\s\S]*$/gi, "");
  out = out.replace(/<think\b[^>]*>[\s\S]*$/gi, "");
  out = out.replace(/<thinking\b[^>]*>[\s\S]*$/gi, "");

  // Orphan close tags left behind.
  out = out.replace(/<\/(?:thought|think|thinking)>/gi, "");

  return out.trim();
}

/**
 * Clean OpenAI chat.completion JSON so Handy only sees the final transcript.
 * Returns whether anything changed.
 */
export function transformChatResponse(body: Record<string, unknown>): boolean {
  const choices = body.choices;
  if (!Array.isArray(choices)) return false;

  let changed = false;

  for (const choice of choices) {
    const choiceObj = asRecord(choice);
    if (!choiceObj) continue;

    const message = asRecord(choiceObj.message);
    if (!message) continue;

    if (typeof message.content === "string") {
      const cleaned = stripThinkingFromContent(message.content);
      if (cleaned !== message.content) {
        message.content = cleaned;
        changed = true;
      }
    }

    // Some OpenAI-compat paths put reasoning beside content.
    for (const key of ["reasoning", "reasoning_content", "reasoning_text"]) {
      if (key in message) {
        delete message[key];
        changed = true;
      }
    }
  }

  return changed;
}

function filterRequestHeaders(headers: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of headers) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    out.set(key, value);
  }
  return out;
}

async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = new URL(url.pathname + url.search, UPSTREAM);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
    });
  }

  const headers = filterRequestHeaders(req.headers);
  let body: BodyInit | undefined;
  const isChat =
    req.method === "POST" &&
    /\/chat\/completions\/?$/.test(url.pathname);

  if (req.method !== "GET" && req.method !== "HEAD") {
    const raw = new Uint8Array(await req.arrayBuffer());
    body = raw;

    if (isChat && raw.byteLength > 0) {
      try {
        const json = JSON.parse(new TextDecoder().decode(raw)) as unknown;
        const record = asRecord(json);
        if (record && transformChatBody(record)) {
          body = JSON.stringify(record);
          headers.set("content-type", "application/json");
          console.log(
            `[transform] model=${String(record.model)} stripped reasoning fields` +
              (GEMMA_THINKING_LEVEL
                ? `; injected thinking_level=${GEMMA_THINKING_LEVEL}`
                : ""),
          );
        }
      } catch (err) {
        console.warn("[transform] skipped non-JSON body:", err);
      }
    }
  }

  console.log(`[proxy] ${req.method} ${url.pathname} → ${target.href}`);

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  // Buffer chat completions so we can strip leaked thinking before Handy pastes.
  if (isChat && upstream.ok) {
    const text = await upstream.text();
    try {
      const json = JSON.parse(text) as unknown;
      const record = asRecord(json);
      if (record && transformChatResponse(record)) {
        const before = text.length;
        const cleaned = JSON.stringify(record);
        console.log(
          `[transform] stripped thinking from response (${before} → ${cleaned.length} chars)`,
        );
        responseHeaders.set("content-type", "application/json");
        return new Response(cleaned, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      }
    } catch (err) {
      console.warn("[transform] response cleanup skipped:", err);
    }

    return new Response(text, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

if (import.meta.main) {
  console.log(
    `handy-gemma-proxy listening on http://${HOST}:${PORT}\n` +
      `  upstream: ${UPSTREAM}\n` +
      `  Handy Custom base URL: http://${HOST}:${PORT}/v1beta/openai\n` +
      `  Gemma thinking_level inject: ${GEMMA_THINKING_LEVEL || "(off — strip only)"}`,
  );

  Deno.serve({ hostname: HOST, port: PORT }, proxy);
}
