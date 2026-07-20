/**
 * Local analytics dashboard for OpenCode SQLite (`opencode.db`).
 *
 * Usage:
 *   deno run --allow-read --allow-env --allow-net --allow-run --allow-sys=osRelease,uid web/opencode.tsx
 *
 * Optional:
 *   OPENCODE_DB=/path/to/opencode.db
 *   PORT=<n>   (omit for a random free port)
 */
import { DatabaseSync } from "node:sqlite";
import { type Context, Hono } from "@hono/hono";
import open from "open";

const portEnv = Deno.env.get("PORT");
const parsedPort = portEnv === undefined || portEnv === "" ? 0 : Number(portEnv);
const listenPort = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 0;
const dbPath =
  Deno.env.get("OPENCODE_DB") ?? `${Deno.env.get("HOME") ?? ""}/.local/share/opencode/opencode.db`;

function loadAnalytics() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const totalsRaw = db
      .prepare(`
      SELECT
        (SELECT COUNT(*) FROM session) AS sessions,
        (SELECT COUNT(*) FROM project) AS projects,
        (SELECT COUNT(*) FROM message
         WHERE json_extract(data, '$.role') = 'user') AS user_messages,
        (SELECT COUNT(*) FROM part
         WHERE json_extract(data, '$.type') = 'tool') AS tool_calls,
        (SELECT COUNT(*) FROM message
         WHERE json_extract(data, '$.role') = 'assistant'
           AND json_extract(data, '$.tokens.total') IS NOT NULL) AS llm_responses,
        (SELECT COUNT(DISTINCT session_id) FROM message
         WHERE json_extract(data, '$.role') = 'assistant'
           AND json_extract(data, '$.tokens.total') IS NOT NULL) AS sessions_with_llm,
        (SELECT COALESCE(SUM(CAST(json_extract(data, '$.tokens.total') AS INTEGER)), 0)
         FROM message
         WHERE json_extract(data, '$.role') = 'assistant'
           AND json_extract(data, '$.tokens.total') IS NOT NULL) AS tokens_total,
        (SELECT COALESCE(SUM(CAST(json_extract(data, '$.cost') AS REAL)), 0)
         FROM message
         WHERE json_extract(data, '$.role') = 'assistant') AS cost_total
    `)
      .get() as Record<string, number>;
    const totals = {
      ...totalsRaw,
      requests: totalsRaw.user_messages + totalsRaw.tool_calls,
    } as Record<string, number>;

    const sessionsPerDay = db
      .prepare(`
      SELECT
        date(time_created / 1000, 'unixepoch') AS day,
        COUNT(*) AS count
      FROM session
      GROUP BY day
      ORDER BY day
    `)
      .all() as { day: string; count: number }[];

    const sessionsByProjectDay = db
      .prepare(`
      SELECT
        date(s.time_created / 1000, 'unixepoch') AS day,
        p.id AS project_id,
        COALESCE(NULLIF(TRIM(p.name), ''), p.worktree, '(unknown)') AS project_label,
        COUNT(*) AS count
      FROM session s
      JOIN project p ON p.id = s.project_id
      GROUP BY day, p.id
      ORDER BY day, p.id
    `)
      .all() as {
      day: string;
      project_id: number;
      project_label: string;
      count: number;
    }[];

    const tokensByProjectDay = db
      .prepare(`
      SELECT
        date(
          COALESCE(
            CAST(json_extract(m.data, '$.time.completed') AS INTEGER),
            CAST(json_extract(m.data, '$.time.created') AS INTEGER)
          ) / 1000,
          'unixepoch'
        ) AS day,
        p.id AS project_id,
        COALESCE(NULLIF(TRIM(p.name), ''), p.worktree, '(unknown)') AS project_label,
        SUM(CAST(json_extract(m.data, '$.tokens.total') AS INTEGER)) AS tokens
      FROM message m
      JOIN session s ON s.id = m.session_id
      JOIN project p ON p.id = s.project_id
      WHERE json_extract(m.data, '$.role') = 'assistant'
        AND json_extract(m.data, '$.tokens.total') IS NOT NULL
      GROUP BY day, p.id
      ORDER BY day, p.id
    `)
      .all() as {
      day: string;
      project_id: number;
      project_label: string;
      tokens: number;
    }[];

    const requestsByProjectDay = db
      .prepare(`
      SELECT
        day,
        project_id,
        MAX(project_label) AS project_label,
        SUM(cnt) AS count
      FROM (
        SELECT
          date(m.time_created / 1000, 'unixepoch') AS day,
          p.id AS project_id,
          COALESCE(NULLIF(TRIM(p.name), ''), p.worktree, '(unknown)') AS project_label,
          COUNT(*) AS cnt
        FROM message m
        JOIN session s ON s.id = m.session_id
        JOIN project p ON p.id = s.project_id
        WHERE json_extract(m.data, '$.role') = 'user'
        GROUP BY day, p.id, project_label

        UNION ALL

        SELECT
          date(pt.time_created / 1000, 'unixepoch') AS day,
          p.id AS project_id,
          COALESCE(NULLIF(TRIM(p.name), ''), p.worktree, '(unknown)') AS project_label,
          COUNT(*) AS cnt
        FROM part pt
        JOIN session s ON s.id = pt.session_id
        JOIN project p ON p.id = s.project_id
        WHERE json_extract(pt.data, '$.type') = 'tool'
        GROUP BY day, p.id, project_label
      )
      GROUP BY day, project_id
      ORDER BY day, project_id
    `)
      .all() as {
      day: string;
      project_id: number;
      project_label: string;
      count: number;
    }[];

    const sessionDays = sessionsPerDay.length;
    const firstDay = sessionsPerDay[0]?.day;
    const lastDay = sessionsPerDay.at(-1)?.day;
    let calendarSpanDays = 0;
    if (firstDay && lastDay) {
      const a = Date.parse(`${firstDay}T00:00:00Z`);
      const b = Date.parse(`${lastDay}T00:00:00Z`);
      calendarSpanDays = Math.floor((b - a) / 86400000) + 1;
    }

    const usageByDayLlm = db
      .prepare(`
      SELECT
        date(
          COALESCE(
            CAST(json_extract(data, '$.time.completed') AS INTEGER),
            CAST(json_extract(data, '$.time.created') AS INTEGER)
          ) / 1000,
          'unixepoch'
        ) AS day,
        SUM(CAST(json_extract(data, '$.tokens.total') AS INTEGER)) AS tokens,
        COUNT(*) AS llm_responses
      FROM message
      WHERE json_extract(data, '$.role') = 'assistant'
        AND json_extract(data, '$.tokens.total') IS NOT NULL
      GROUP BY day
      ORDER BY day
    `)
      .all() as { day: string; tokens: number; llm_responses: number }[];

    const requestsByDay = db
      .prepare(`
      SELECT day, SUM(c) AS requests FROM (
        SELECT date(time_created / 1000, 'unixepoch') AS day, COUNT(*) AS c
        FROM message
        WHERE json_extract(data, '$.role') = 'user'
        GROUP BY day
        UNION ALL
        SELECT date(time_created / 1000, 'unixepoch') AS day, COUNT(*) AS c
        FROM part
        WHERE json_extract(data, '$.type') = 'tool'
        GROUP BY day
      )
      GROUP BY day
      ORDER BY day
    `)
      .all() as { day: string; requests: number }[];

    const llmByDay = Object.fromEntries(usageByDayLlm.map((r) => [r.day, r]));
    const reqByDay = Object.fromEntries(requestsByDay.map((r) => [r.day, r.requests]));
    const usageDaysSorted = [
      ...new Set([...usageByDayLlm.map((r) => r.day), ...requestsByDay.map((r) => r.day)]),
    ].sort();
    const usageByDay = usageDaysSorted.map((day) => ({
      day,
      tokens: llmByDay[day]?.tokens ?? 0,
      llm_responses: llmByDay[day]?.llm_responses ?? 0,
      requests: reqByDay[day] ?? 0,
    }));

    const activeUsageDays = usageByDayLlm.length;
    const activeRequestDays = requestsByDay.length;

    const modelBreakdown = db
      .prepare(`
      SELECT
        COALESCE(json_extract(data, '$.modelID'), '(unknown)') AS model,
        SUM(CAST(json_extract(data, '$.tokens.total') AS INTEGER)) AS tokens,
        COUNT(*) AS llm_responses
      FROM message
      WHERE json_extract(data, '$.role') = 'assistant'
        AND json_extract(data, '$.tokens.total') IS NOT NULL
      GROUP BY model
      ORDER BY tokens DESC
      LIMIT 25
    `)
      .all() as { model: string; tokens: number; llm_responses: number }[];

    const providerBreakdown = db
      .prepare(`
      SELECT
        COALESCE(json_extract(data, '$.providerID'), '(unknown)') AS provider,
        SUM(CAST(json_extract(data, '$.tokens.total') AS INTEGER)) AS tokens,
        COUNT(*) AS llm_responses
      FROM message
      WHERE json_extract(data, '$.role') = 'assistant'
        AND json_extract(data, '$.tokens.total') IS NOT NULL
      GROUP BY provider
      ORDER BY tokens DESC
      LIMIT 25
    `)
      .all() as { provider: string; tokens: number; llm_responses: number }[];

    const projectSessions = db
      .prepare(`
      SELECT
        p.worktree,
        p.name,
        COUNT(s.id) AS sessions
      FROM session s
      JOIN project p ON p.id = s.project_id
      GROUP BY p.id
      ORDER BY sessions DESC
      LIMIT 20
    `)
      .all() as { worktree: string; name: string | null; sessions: number }[];

    const avgSessionsPerActiveDay = sessionDays > 0 ? totals.sessions / sessionDays : 0;
    const avgSessionsPerCalendarDay = calendarSpanDays > 0 ? totals.sessions / calendarSpanDays : 0;

    const avgTokensPerActiveUsageDay =
      activeUsageDays > 0 ? totals.tokens_total / activeUsageDays : 0;
    const avgLlmResponsesPerActiveUsageDay =
      activeUsageDays > 0 ? totals.llm_responses / activeUsageDays : 0;
    const avgRequestsPerActiveRequestDay =
      activeRequestDays > 0 ? totals.requests / activeRequestDays : 0;

    const avgTokensPerSessionWithLlm =
      totals.sessions_with_llm > 0 ? totals.tokens_total / totals.sessions_with_llm : 0;
    const avgLlmResponsesPerSessionWithLlm =
      totals.sessions_with_llm > 0 ? totals.llm_responses / totals.sessions_with_llm : 0;
    const avgTokensPerLlmResponse =
      totals.llm_responses > 0 ? totals.tokens_total / totals.llm_responses : 0;

    const perCalendarDay =
      calendarSpanDays > 0
        ? {
            sessions: totals.sessions / calendarSpanDays,
            requests: totals.requests / calendarSpanDays,
            responses: totals.llm_responses / calendarSpanDays,
            tokens: totals.tokens_total / calendarSpanDays,
          }
        : {
            sessions: 0,
            requests: 0,
            responses: 0,
            tokens: 0,
          };

    return {
      meta: {
        dbPath,
        generatedAt: new Date().toISOString(),
        firstSessionDay: firstDay ?? null,
        lastSessionDay: lastDay ?? null,
        calendarSpanDays,
        activeSessionDays: sessionDays,
        activeUsageDays,
        activeRequestDays,
      },
      totals,
      averages: {
        sessionsPerActiveDay: avgSessionsPerActiveDay,
        sessionsPerCalendarDay: avgSessionsPerCalendarDay,
        tokensPerActiveUsageDay: avgTokensPerActiveUsageDay,
        llmResponsesPerActiveUsageDay: avgLlmResponsesPerActiveUsageDay,
        requestsPerActiveRequestDay: avgRequestsPerActiveRequestDay,
        tokensPerSessionWithLlm: avgTokensPerSessionWithLlm,
        llmResponsesPerSessionWithLlm: avgLlmResponsesPerSessionWithLlm,
        tokensPerLlmResponse: avgTokensPerLlmResponse,
        perCalendarDay,
      },
      series: {
        sessionsPerDay,
        usageByDay,
        sessionsByProjectDay,
        tokensByProjectDay,
        requestsByProjectDay,
      },
      breakdowns: {
        model: modelBreakdown,
        provider: providerBreakdown,
        projectSessions,
      },
    };
  } finally {
    db.close();
  }
}

const dashboardCss = Deno.readTextFileSync(new URL("./opencode.css", import.meta.url));
const dashboardJs = Deno.readTextFileSync(
  new URL("./opencode.client.js", import.meta.url),
);

function DashboardPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0a0b10" />
        <title>OpenCode · local usage</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=Manrope:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
        <style dangerouslySetInnerHTML={{ __html: dashboardCss }} />
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to analytics
        </a>
        <header>
          <div class="header-inner">
            <div>
              <p class="eyebrow">Local SQLite</p>
              <h1>
                OpenCode <span>usage</span>
              </h1>
              <p class="sub" id="meta" aria-live="polite">
                Connecting to your database…
              </p>
            </div>
            <div class="header-actions">
              <button type="button" class="btn" id="reload" aria-label="Reload dashboard data">
                Reload data
              </button>
            </div>
          </div>
          <div class="header-range reveal d1">
            <div class="range-bar" id="range-bar" role="toolbar" aria-label="Chart date range">
              <p class="range-label" id="range-label-text">
                Trend range
              </p>
              <div class="range-seg" role="group" aria-labelledby="range-label-text">
                <button type="button" class="btn range-btn" data-range="7d">
                  Last 7d
                </button>
                <button type="button" class="btn range-btn" data-range="30d">
                  Last 30d
                </button>
                <button type="button" class="btn range-btn" data-range="90d">
                  Last 90d
                </button>
                <button type="button" class="btn range-btn" data-range="1y">
                  Last 1y
                </button>
                <button type="button" class="btn range-btn" data-range="all">
                  All time
                </button>
              </div>
            </div>
          </div>
        </header>
        <main id="main">
          <div id="err" role="alert" aria-live="assertive"></div>
          <div id="banner" hidden class="banner" role="status" aria-live="polite"></div>
          <div class="grid reveal d1" id="kpis" aria-busy="true" aria-label="Key metrics"></div>
          <section class="reveal d2" aria-labelledby="trends-heading">
            <h2 id="trends-heading">Rhythm</h2>
            <p class="section-lead">
              Sessions, tokens, and requests per day, stacked by project—see where activity
              concentrates (UTC calendar days).
            </p>
            <div class="charts">
              <div class="chart-wrap">
                <h3>Sessions / day</h3>
                <canvas
                  id="chSessions"
                  width={400}
                  height={260}
                  aria-label="Stacked bar chart of sessions per day by project"
                ></canvas>
              </div>
              <div class="chart-wrap">
                <h3>Tokens / day</h3>
                <canvas
                  id="chUsage"
                  width={400}
                  height={260}
                  aria-label="Stacked bar chart of tokens per day by project"
                ></canvas>
              </div>
              <div class="chart-wrap">
                <h3>Requests / day</h3>
                <canvas
                  id="chRequests"
                  width={400}
                  height={260}
                  aria-label="Stacked bar chart of requests per day by project"
                ></canvas>
              </div>
            </div>
          </section>
          <section class="reveal d3" aria-labelledby="breakdowns-heading">
            <h2 id="breakdowns-heading">Models & providers</h2>
            <p class="section-lead">
              Where spend concentrates—trim models or providers you do not need.
            </p>
            <div class="charts two">
              <div class="chart-wrap">
                <h3>Top models</h3>
                <canvas
                  id="chModel"
                  width={400}
                  height={260}
                  aria-label="Horizontal bar chart of tokens by model"
                ></canvas>
              </div>
              <div class="chart-wrap">
                <h3>Top providers</h3>
                <canvas
                  id="chProvider"
                  width={400}
                  height={260}
                  aria-label="Horizontal bar chart of tokens by provider"
                ></canvas>
              </div>
            </div>
          </section>
          <section class="reveal d3" aria-labelledby="projects-heading">
            <h2 id="projects-heading">Projects</h2>
            <p class="section-lead">Worktrees ranked by how often you start a session there.</p>
            <div id="projects"></div>
          </section>
          <footer>
            <strong>Requests</strong> = user <code>message</code> rows + <code>part</code> rows with{" "}
            <code>type: "tool"</code>.<strong>LLM responses</strong> = assistant{" "}
            <code>message</code> rows with <code>tokens.total</code>. Refresh the page or use Reload
            to pull the latest snapshot. Raw JSON lives at <code>/api/analytics.json</code>.
          </footer>
        </main>
        <script dangerouslySetInnerHTML={{ __html: dashboardJs }} />
      </body>
    </html>
  );
}

function dashboardHtml(c: Context) {
  return c.html(<DashboardPage />);
}

const app = new Hono();

app.use(async (c, next) => {
  if (c.req.method !== "GET") {
    return c.text("Method not allowed", 405);
  }
  await next();
});

app.get("/", dashboardHtml);
app.get("/index.html", dashboardHtml);

app.get("/api/analytics.json", (c) => {
  try {
    return c.json(loadAnalytics(), 200, {
      "cache-control": "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 500);
  }
});

app.notFound((c) => c.text("Not found", 404));

const server = Deno.serve({ port: listenPort }, app.fetch);

const dashboardUrl = `http://127.0.0.1:${server.addr.port}/`;
console.error(`OpenCode analytics → ${dashboardUrl}  (${dbPath})`);
void open(dashboardUrl).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Could not open browser: ${msg}`);
});
