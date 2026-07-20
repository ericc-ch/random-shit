/**
 * Local analytics dashboard for Cursor IDE project caches under
 * `~/.cursor/projects` (agent transcript JSONL + filesystem metadata).
 *
 * Usage:
 *   deno run --allow-read --allow-env --allow-net --allow-run --allow-sys=osRelease,uid web/cursor.tsx
 *
 * Optional:
 *   CURSOR_PROJECTS_DIR=/path/to/.cursor/projects
 *   PORT=<n>   (omit for a random free port)
 */
import { type Context, Hono } from "@hono/hono";
import open from "open";

const portEnv = Deno.env.get("PORT");
const parsedPort = portEnv === undefined || portEnv === "" ? 0 : Number(portEnv);
const listenPort = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 0;
const projectsRoot =
  Deno.env.get("CURSOR_PROJECTS_DIR") ?? `${Deno.env.get("HOME") ?? ""}/.cursor/projects`;

function utcDayFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

async function* readUtf8Lines(path: string) {
  using file = await Deno.open(path);
  const dec = new TextDecoder();
  let carry = "";
  const buf = new Uint8Array(1 << 16);
  while (true) {
    const n = await file.read(buf);
    if (n === null) {
      carry += dec.decode();
      if (carry.length > 0) yield carry;
      break;
    }
    carry += dec.decode(buf.subarray(0, n), { stream: true });
    for (;;) {
      const nl = carry.indexOf("\n");
      if (nl === -1) break;
      let line = carry.slice(0, nl);
      carry = carry.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      yield line;
    }
  }
}

function countMessageRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.length) {
    return { user: 0, assistant: 0, tool: 0, parsed: false };
  }
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { user: 0, assistant: 0, tool: 0, parsed: false };
  }
  const role = row.role;
  let user = 0;
  let assistant = 0;
  if (role === "user") user = 1;
  else if (role === "assistant") assistant = 1;
  let tool = 0;
  const msg = row.message as Record<string, unknown> | undefined;
  const content = msg?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && "type" in part) {
        const t = (part as { type?: string }).type;
        if (t === "tool_use") tool += 1;
      }
    }
  }
  return { user, assistant, tool, parsed: true };
}

async function scanJsonlFile(path: string) {
  const st = await Deno.stat(path);
  const mtimeMs = st.mtime?.getTime() ?? Date.now();
  const birthMs = st.birthtime?.getTime() ?? mtimeMs;
  const modMs = mtimeMs;
  let lines = 0;
  let user = 0;
  let assistant = 0;
  let tool = 0;
  let parsedLines = 0;
  for await (const line of readUtf8Lines(path)) {
    lines += 1;
    const c = countMessageRow(line);
    user += c.user;
    assistant += c.assistant;
    tool += c.tool;
    if (c.parsed) parsedLines += 1;
  }
  return {
    bytes: st.size,
    lines,
    user,
    assistant,
    tool,
    parsedLines,
    birthMs,
    modMs,
    isSubagent: path.includes(`${"agent-transcripts"}/`) && path.includes("/subagents/"),
  };
}

function bumpDaySlug(map: Map<string, number>, day: string, slug: string, delta = 1) {
  const k = `${day}\t${slug}`;
  map.set(k, (map.get(k) ?? 0) + delta);
}

function addUtcDay(isoDay: string, delta: number) {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
}

function spreadRequestsAcrossDays(
  startDay: string,
  endDay: string,
  total: number,
  slug: string,
  map: Map<string, number>,
  trackDays: (d: string) => void,
) {
  if (total <= 0) return;
  let a = startDay;
  let b = endDay;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  const labels: string[] = [];
  let cur = a;
  while (cur <= b) {
    labels.push(cur);
    trackDays(cur);
    cur = addUtcDay(cur, 1);
  }
  const n = labels.length;
  if (n === 0) return;
  const base = Math.floor(total / n);
  let rem = total - base * n;
  for (const d of labels) {
    const add = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    bumpDaySlug(map, d, slug, add);
  }
}

function mapToProjectDaySeries(map: Map<string, number>) {
  const rows: {
    day: string;
    project_id: string;
    project_label: string;
    count: number;
  }[] = [];
  for (const [k, count] of map) {
    const [day, slug] = k.split("\t");
    rows.push({
      day,
      project_id: slug,
      project_label: slug,
      count,
    });
  }
  rows.sort((a, b) =>
    a.day === b.day ? a.project_id.localeCompare(b.project_id) : a.day.localeCompare(b.day),
  );
  return rows;
}

async function loadAnalytics() {
  const scanErrors: string[] = [];
  let workspaces = 0;
  let conversationDirs = 0;
  let transcriptFiles = 0;
  let subagentFiles = 0;
  let totalBytes = 0;
  let totalLines = 0;
  let userRows = 0;
  let assistantRows = 0;
  let toolUses = 0;
  let mainTranscriptFiles = 0;

  const sessionsMap = new Map<string, number>();
  const requestsMap = new Map<string, number>();
  const linesBySlug = new Map<string, number>();
  const bytesBySlug = new Map<string, number>();
  const filesBySlug = new Map<string, number>();

  let firstDay: string | null = null;
  let lastDay: string | null = null;
  const considerDay = (d: string) => {
    if (!firstDay || d < firstDay) firstDay = d;
    if (!lastDay || d > lastDay) lastDay = d;
  };

  try {
    for await (const ws of Deno.readDir(projectsRoot)) {
      if (!ws.isDirectory) continue;
      const slug = ws.name;
      const atRoot = `${projectsRoot}/${slug}/agent-transcripts`;
      let atStat;
      try {
        atStat = await Deno.stat(atRoot);
      } catch {
        continue;
      }
      if (!atStat.isDirectory) continue;
      workspaces += 1;

      for await (const conv of Deno.readDir(atRoot)) {
        if (!conv.isDirectory) continue;
        conversationDirs += 1;
        const convPath = `${atRoot}/${conv.name}`;
        for await (const inner of Deno.readDir(convPath)) {
          const p = `${convPath}/${inner.name}`;
          if (inner.isFile && inner.name.endsWith(".jsonl")) {
            transcriptFiles += 1;
            filesBySlug.set(slug, (filesBySlug.get(slug) ?? 0) + 1);
            try {
              const m = await scanJsonlFile(p);
              totalBytes += m.bytes;
              totalLines += m.lines;
              userRows += m.user;
              assistantRows += m.assistant;
              toolUses += m.tool;
              linesBySlug.set(slug, (linesBySlug.get(slug) ?? 0) + m.lines);
              bytesBySlug.set(slug, (bytesBySlug.get(slug) ?? 0) + m.bytes);
              mainTranscriptFiles += 1;
              const birthDay = utcDayFromMs(m.birthMs);
              const modDay = utcDayFromMs(m.modMs);
              considerDay(birthDay);
              considerDay(modDay);
              bumpDaySlug(sessionsMap, birthDay, slug, 1);
              const req = m.user + m.tool;
              spreadRequestsAcrossDays(birthDay, modDay, req, slug, requestsMap, considerDay);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              scanErrors.push(`${p}: ${msg}`);
            }
          } else if (inner.isDirectory && inner.name === "subagents") {
            const subRoot = p;
            for await (const sf of Deno.readDir(subRoot)) {
              if (!sf.isFile || !sf.name.endsWith(".jsonl")) continue;
              const sp = `${subRoot}/${sf.name}`;
              transcriptFiles += 1;
              subagentFiles += 1;
              filesBySlug.set(slug, (filesBySlug.get(slug) ?? 0) + 1);
              try {
                const m = await scanJsonlFile(sp);
                totalBytes += m.bytes;
                totalLines += m.lines;
                userRows += m.user;
                assistantRows += m.assistant;
                toolUses += m.tool;
                linesBySlug.set(slug, (linesBySlug.get(slug) ?? 0) + m.lines);
                bytesBySlug.set(slug, (bytesBySlug.get(slug) ?? 0) + m.bytes);
                const birthDay = utcDayFromMs(m.birthMs);
                const modDay = utcDayFromMs(m.modMs);
                considerDay(birthDay);
                considerDay(modDay);
                const req = m.user + m.tool;
                spreadRequestsAcrossDays(birthDay, modDay, req, slug, requestsMap, considerDay);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                scanErrors.push(`${sp}: ${msg}`);
              }
            }
          }
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Cannot read ${projectsRoot}: ${msg}`);
  }

  let calendarSpanDays = 0;
  if (firstDay && lastDay) {
    const a = Date.parse(`${firstDay}T00:00:00Z`);
    const b = Date.parse(`${lastDay}T00:00:00Z`);
    calendarSpanDays = Math.floor((b - a) / 86400000) + 1;
  }

  const activeSessionDays = new Set([...sessionsMap.keys()].map((k) => k.split("\t")[0])).size;
  const activeRequestDays = new Set([...requestsMap.keys()].map((k) => k.split("\t")[0])).size;

  const projectLines = [...linesBySlug.entries()]
    .map(([slug, lines]) => ({
      slug,
      lines,
      bytes: bytesBySlug.get(slug) ?? 0,
      files: filesBySlug.get(slug) ?? 0,
    }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 25);

  const requests = userRows + toolUses;

  return {
    meta: {
      projectsRoot,
      generatedAt: new Date().toISOString(),
      firstDay,
      lastDay,
      calendarSpanDays,
      activeSessionDays,
      activeRequestDays,
      scanErrors: scanErrors.slice(0, 12),
      scanErrorCount: scanErrors.length,
    },
    totals: {
      workspaces,
      conversation_dirs: conversationDirs,
      transcript_files: transcriptFiles,
      subagent_files: subagentFiles,
      jsonl_lines: totalLines,
      bytes_total: totalBytes,
      user_rows: userRows,
      assistant_rows: assistantRows,
      tool_uses: toolUses,
      requests,
      main_transcript_files: mainTranscriptFiles,
    },
    averages: {
      linesPerWorkspace: workspaces > 0 ? totalLines / workspaces : 0,
      linesPerConversationDir: conversationDirs > 0 ? totalLines / conversationDirs : 0,
      filesPerWorkspace: workspaces > 0 ? transcriptFiles / workspaces : 0,
      requestsPerLine: totalLines > 0 ? requests / totalLines : 0,
      perCalendarDay:
        calendarSpanDays > 0
          ? {
              sessions: mainTranscriptFiles / calendarSpanDays,
              requests: requests / calendarSpanDays,
            }
          : { sessions: 0, requests: 0 },
    },
    series: {
      sessionsByProjectDay: mapToProjectDaySeries(sessionsMap),
      requestsByProjectDay: mapToProjectDaySeries(requestsMap),
    },
    breakdowns: {
      projectLines,
    },
  };
}

const dashboardCss = Deno.readTextFileSync(
  new URL("./cursor.css", import.meta.url),
);
const dashboardJs = Deno.readTextFileSync(
  new URL("./cursor.client.js", import.meta.url),
);

function DashboardPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0a0b10" />
        <title>Cursor · local projects</title>
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
              <p class="eyebrow">Local filesystem</p>
              <h1>
                Cursor <span>projects</span>
              </h1>
              <p class="sub" id="meta" aria-live="polite">
                Scanning your project caches…
              </p>
            </div>
            <div class="header-actions">
              <button type="button" class="btn" id="reload" aria-label="Reload dashboard data">
                Rescan
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
              Sessions = new main transcript JSONL files per UTC day (birth time). Requests = user
              rows + tool uses from each file, spread evenly across that file’s birth → last
              modified day (JSONL has no per-line timestamps).
            </p>
            <div class="charts two">
              <div class="chart-wrap">
                <h3>Sessions / day</h3>
                <canvas
                  id="chSessions"
                  width={400}
                  height={260}
                  aria-label="Stacked bar chart of new sessions per day by workspace slug"
                ></canvas>
              </div>
              <div class="chart-wrap">
                <h3>Requests / day</h3>
                <canvas
                  id="chRequests"
                  width={400}
                  height={260}
                  aria-label="Stacked bar chart of requests per day by workspace slug"
                ></canvas>
              </div>
            </div>
          </section>
          <section class="reveal d3" aria-labelledby="projects-heading">
            <h2 id="projects-heading">Workspaces</h2>
            <p class="section-lead">
              Folder names under <code>.cursor/projects</code> (Cursor’s path slug), ranked by
              transcript line volume.
            </p>
            <div id="projects"></div>
          </section>
          <footer>
            <strong>Sessions</strong> = one new main transcript file. <strong>Requests</strong> ={" "}
            <code>user</code> rows plus <code>tool_use</code> parts (same spirit as OpenCode),
            attributed across days by birth→mtime spread. Set <code>CURSOR_PROJECTS_DIR</code> to
            override the scan root. Raw JSON lives at <code>/api/analytics.json</code>.
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

app.get("/api/analytics.json", async (c) => {
  try {
    const body = await loadAnalytics();
    return c.json(body, 200, {
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
console.error(`Cursor projects analytics → ${dashboardUrl}  (${projectsRoot})`);
void open(dashboardUrl).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Could not open browser: ${msg}`);
});
