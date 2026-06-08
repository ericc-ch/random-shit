/**
 * httpbin-style /cookies, but assigns a random cookie on first visit.
 *
 * Usage:
 *   deno run --allow-net --allow-env cookie-bin.ts
 *
 * Optional:
 *   PORT=8080
 */
import { Hono } from "@hono/hono";
import { getCookie, setCookie } from "@hono/hono/cookie";

const COOKIE_NAME = "id";

const portEnv = Deno.env.get("PORT");
const parsedPort = portEnv === undefined || portEnv === "" ? 8787 : Number(portEnv);
const listenPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8787;

function parseCookieHeader(header: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    cookies[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return cookies;
}

function randomId() {
  return crypto.randomUUID();
}

const app = new Hono();

app.get("/", (c) =>
  c.json({
    message: "GET /cookies — auto-assigns a random cookie per browser, then echoes it",
    example: `http://127.0.0.1:${listenPort}/cookies`,
  }),
);

app.get("/cookies", (c) => {
  const cookies = parseCookieHeader(c.req.header("cookie"));
  let id = getCookie(c, COOKIE_NAME);

  if (!id) {
    id = randomId();
    setCookie(c, COOKIE_NAME, id, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });
    cookies[COOKIE_NAME] = id;
  }

  return c.json({ cookies });
});

const server = Deno.serve({ port: listenPort, hostname: "0.0.0.0" }, app.fetch);
console.log(`cookie-bin listening on http://127.0.0.1:${server.addr.port}/cookies`);
