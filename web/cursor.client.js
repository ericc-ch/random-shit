const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 });
const fmtBytes = (b) => {
  if (b < 1024) return fmt(b) + " B";
  if (b < 1024 * 1024) return fmt(b / 1024) + " KB";
  return fmt(b / (1024 * 1024)) + " MB";
};
const chartText = "#c4c6d0";
const chartGrid = "rgba(255,255,255,0.06)";
const chartTooltip = {
  backgroundColor: "rgba(17,19,26,0.94)",
  titleColor: "#e8e9ed",
  bodyColor: "#c4c6d0",
  borderColor: "rgba(255,255,255,0.08)",
  borderWidth: 1,
};
function skeletonKpis(container, n) {
  container.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "skeleton";
    d.setAttribute("aria-hidden", "true");
    container.appendChild(d);
  }
}
function kpi(label, value, hint) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML =
    '<div class="label">' +
    label +
    '</div><div class="value">' +
    value +
    "</div>" +
    (hint ? '<div class="hint">' + hint + "</div>" : "");
  return el;
}
const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
let trendCharts = [];
let analyticsData = null;
let currentRange = "30d";

function destroyTrendCharts() {
  trendCharts.forEach((c) => c.destroy());
  trendCharts = [];
}
function utcTodayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(isoDay, delta) {
  return new Date(Date.parse(isoDay + "T00:00:00Z") + delta * 86400000).toISOString().slice(0, 10);
}
function rangeStartDay(range) {
  if (range === "all") return null;
  const n = RANGE_DAYS[range];
  return addDays(utcTodayStr(), -(n - 1));
}
function enumerateDays(a, b) {
  const out = [];
  let cur = a;
  while (cur <= b) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
function dayLabelsForRange(range, sessionRows, requestRows) {
  const combined = [...sessionRows.map((r) => r.day), ...requestRows.map((r) => r.day)];
  const uniq = [...new Set(combined)].sort();
  if (!uniq.length) return [];
  if (range === "all") return enumerateDays(uniq[0], uniq[uniq.length - 1]);
  const start = rangeStartDay(range);
  const end = utcTodayStr();
  return enumerateDays(start, end);
}
function filterRowsByRange(rows, range) {
  if (range === "all") return rows.slice();
  const start = rangeStartDay(range);
  return rows.filter((r) => r.day >= start);
}
function paletteColor(i) {
  const preset = [
    "rgba(125, 211, 252, 0.78)",
    "rgba(251, 113, 133, 0.75)",
    "rgba(251, 191, 36, 0.78)",
    "rgba(167, 139, 250, 0.78)",
    "rgba(56, 189, 248, 0.75)",
    "rgba(52, 211, 153, 0.72)",
    "rgba(244, 114, 182, 0.72)",
    "rgba(250, 204, 21, 0.72)",
    "rgba(129, 140, 248, 0.75)",
    "rgba(45, 212, 191, 0.72)",
  ];
  if (i < preset.length) return preset[i];
  const hue = (i * 41) % 360;
  return "hsla(" + hue + ", 58%, 60%, 0.78)";
}
function truncateLabel(s) {
  return s.length > 36 ? s.slice(0, 34) + "…" : s;
}
function buildStackedDatasets(rows, labels, valueField, topK) {
  const totals = new Map();
  const labelById = new Map();
  for (const r of rows) {
    const id = r.project_id;
    totals.set(id, (totals.get(id) ?? 0) + r[valueField]);
    labelById.set(id, r.project_label);
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, topK).map((x) => x[0]);
  const tail = sorted.slice(topK).map((x) => x[0]);
  const stackId = "trend";
  const datasets = [];
  for (const pid of head) {
    datasets.push({
      label: truncateLabel(labelById.get(pid) ?? String(pid)),
      data: labels.map(() => 0),
      backgroundColor: paletteColor(datasets.length),
      borderRadius: 3,
      borderSkipped: false,
      stack: stackId,
    });
  }
  let otherIdx = -1;
  if (tail.length) {
    otherIdx = datasets.length;
    datasets.push({
      label: "Other (" + tail.length + ")",
      data: labels.map(() => 0),
      backgroundColor: paletteColor(datasets.length),
      borderRadius: 3,
      borderSkipped: false,
      stack: stackId,
    });
  }
  const headIndex = Object.fromEntries(head.map((id, i) => [id, i]));
  const tailSet = new Set(tail);
  const dayIndex = Object.fromEntries(labels.map((d, i) => [d, i]));
  for (const r of rows) {
    const di = dayIndex[r.day];
    if (di === undefined) continue;
    let si = headIndex[r.project_id];
    if (si === undefined && tailSet.has(r.project_id)) si = otherIdx;
    if (si === undefined) continue;
    datasets[si].data[di] += r[valueField];
  }
  return datasets;
}
function tooltipTopProjectsFooter(tooltipItems) {
  if (!tooltipItems.length) return "";
  const chart = tooltipItems[0].chart;
  const dataIndex = tooltipItems[0].dataIndex;
  let sum = 0;
  let nonzero = 0;
  for (let i = 0; i < chart.data.datasets.length; i++) {
    const v = chart.data.datasets[i].data[dataIndex];
    if (typeof v === "number" && !Number.isNaN(v)) {
      sum += v;
      if (v > 0) nonzero++;
    }
  }
  const hidden = Math.max(0, nonzero - 5);
  let out = "Day total: " + fmt(sum);
  if (hidden > 0) {
    out += "\n" + hidden + " more workspace" + (hidden === 1 ? "" : "s") + " not shown";
  }
  return out;
}
function stackedBarChart(ctx, labels, datasets, yTitle) {
  return new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: chartText,
            boxWidth: 10,
            padding: 10,
            font: { size: 10 },
          },
        },
        tooltip: {
          ...chartTooltip,
          padding: 10,
          itemSort: (a, b) => {
            const ya = a.parsed.y;
            const yb = b.parsed.y;
            const na = typeof ya === "number" && !Number.isNaN(ya) ? ya : 0;
            const nb = typeof yb === "number" && !Number.isNaN(yb) ? yb : 0;
            return nb - na;
          },
          filter: (tooltipItem, _index, tooltipItems) => {
            const ranked = tooltipItems.filter((it) => {
              const v = it.parsed.y;
              return typeof v === "number" && !Number.isNaN(v) && v > 0;
            });
            ranked.sort((a, b) => (b.parsed.y ?? 0) - (a.parsed.y ?? 0));
            const top = new Set(ranked.slice(0, 5).map((it) => it.datasetIndex));
            return top.has(tooltipItem.datasetIndex);
          },
          callbacks: {
            footer: tooltipTopProjectsFooter,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: chartText, maxRotation: 55 },
          grid: { color: chartGrid },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: chartText },
          grid: { color: chartGrid },
          title: {
            display: !!yTitle,
            text: yTitle || "",
            color: chartText,
            font: { size: 11 },
          },
        },
      },
    },
  });
}
function setRangeUI(range) {
  document.querySelectorAll(".range-btn").forEach((b) => {
    b.setAttribute("aria-pressed", b.getAttribute("data-range") === range ? "true" : "false");
  });
}
function renderTrendCharts() {
  destroyTrendCharts();
  if (!analyticsData) return;
  const sr = analyticsData.series.sessionsByProjectDay ?? [];
  const rr = analyticsData.series.requestsByProjectDay ?? [];
  const fs = filterRowsByRange(sr, currentRange);
  const fr = filterRowsByRange(rr, currentRange);
  let labels = dayLabelsForRange(currentRange, fs, fr);
  const topK = 18;
  let sessionDs = buildStackedDatasets(fs, labels, "count", topK);
  let requestDs = buildStackedDatasets(fr, labels, "count", topK);
  const emptyTone = "rgba(139, 144, 160, 0.28)";
  if (!labels.length) {
    labels = ["—"];
    sessionDs = [
      {
        label: "No data in range",
        data: [0],
        backgroundColor: emptyTone,
        borderRadius: 3,
        borderSkipped: false,
        stack: "trend",
      },
    ];
    requestDs = [
      {
        label: "No data in range",
        data: [0],
        backgroundColor: emptyTone,
        borderRadius: 3,
        borderSkipped: false,
        stack: "trend",
      },
    ];
  } else {
    if (!sessionDs.length) {
      sessionDs = [
        {
          label: "No sessions",
          data: labels.map(() => 0),
          backgroundColor: emptyTone,
          borderRadius: 3,
          borderSkipped: false,
          stack: "trend",
        },
      ];
    }
    if (!requestDs.length) {
      requestDs = [
        {
          label: "No requests",
          data: labels.map(() => 0),
          backgroundColor: emptyTone,
          borderRadius: 3,
          borderSkipped: false,
          stack: "trend",
        },
      ];
    }
  }
  trendCharts.push(
    stackedBarChart(
      document.getElementById("chSessions").getContext("2d"),
      labels,
      sessionDs,
      "Sessions",
    ),
  );
  trendCharts.push(
    stackedBarChart(
      document.getElementById("chRequests").getContext("2d"),
      labels,
      requestDs,
      "Requests",
    ),
  );
}
async function loadAll() {
  const err = document.getElementById("err");
  const banner = document.getElementById("banner");
  const k = document.getElementById("kpis");
  err.innerHTML = "";
  banner.hidden = true;
  banner.textContent = "";
  destroyTrendCharts();
  analyticsData = null;
  k.setAttribute("aria-busy", "true");
  skeletonKpis(k, 12);
  let data;
  try {
    const res = await fetch("/api/analytics.json");
    if (!res.ok) throw new Error(await res.text());
    data = await res.json();
  } catch (e) {
    k.innerHTML = "";
    k.removeAttribute("aria-busy");
    err.innerHTML =
      "<div class='error'><strong>Could not scan projects.</strong> " + e.message + "</div>";
    document.getElementById("meta").textContent = "Fix the path or permissions, then rescan.";
    return;
  }
  k.removeAttribute("aria-busy");
  k.innerHTML = "";
  document.getElementById("meta").textContent =
    "Reading " +
    data.meta.projectsRoot +
    " · Snapshot " +
    data.meta.generatedAt +
    (data.meta.firstDay ? " · File days " + data.meta.firstDay + " → " + data.meta.lastDay : "");
  if (data.meta.scanErrorCount > 0) {
    banner.hidden = false;
    banner.textContent =
      "Some files failed to parse (" +
      data.meta.scanErrorCount +
      "). Showing partial totals. First error: " +
      (data.meta.scanErrors[0] ?? "unknown");
  }
  if (data.totals.workspaces === 0) {
    banner.hidden = false;
    banner.textContent =
      "No workspaces with agent-transcripts under this root. Open a folder in Cursor first, or point CURSOR_PROJECTS_DIR elsewhere.";
  }
  k.appendChild(kpi("Workspaces", fmt(data.totals.workspaces), "Folders with agent-transcripts"));
  k.appendChild(
    kpi(
      "Conversation dirs",
      fmt(data.totals.conversation_dirs),
      "UUID folders under agent-transcripts",
    ),
  );
  k.appendChild(
    kpi("Transcript files", fmt(data.totals.transcript_files), "JSONL logs (incl. subagents)"),
  );
  k.appendChild(kpi("Subagent logs", fmt(data.totals.subagent_files), "JSONL under subagents/"));
  k.appendChild(
    kpi("JSONL lines", fmt(data.totals.jsonl_lines), "Physical newline-separated rows"),
  );
  k.appendChild(
    kpi("Disk (transcripts)", fmtBytes(data.totals.bytes_total), "Sum of JSONL file sizes"),
  );
  k.appendChild(kpi("User rows", fmt(data.totals.user_rows), "Lines with role user"));
  k.appendChild(
    kpi("Assistant rows", fmt(data.totals.assistant_rows), "Lines with role assistant"),
  );
  k.appendChild(
    kpi("Tool uses", fmt(data.totals.tool_uses), "tool_use parts in assistant payloads"),
  );
  k.appendChild(kpi("Requests (proxy)", fmt(data.totals.requests), "User rows + tool uses"));
  const spanHint =
    data.meta.calendarSpanDays > 0
      ? "Avg per calendar day over " +
        data.meta.calendarSpanDays +
        "-day span (first → last file day)"
      : "No file-day span yet";
  const pc = data.averages.perCalendarDay;
  k.appendChild(kpi("Sessions/day (span)", fmt(pc.sessions), spanHint));
  k.appendChild(kpi("Requests/day (span)", fmt(pc.requests), spanHint));

  Chart.defaults.color = chartText;
  Chart.defaults.borderColor = chartGrid;
  Chart.defaults.font.family = "'Manrope', system-ui, sans-serif";

  analyticsData = data;
  setRangeUI(currentRange);
  renderTrendCharts();

  const proj = document.getElementById("projects");
  proj.innerHTML = "";
  if (!data.breakdowns.projectLines.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML =
      "<strong>No transcripts yet</strong><p>Once Cursor writes JSONL under this root, workspaces will appear here.</p>";
    proj.appendChild(empty);
  } else {
    const pt = document.createElement("table");
    pt.innerHTML =
      "<thead><tr><th scope='col'>Workspace slug</th><th scope='col' class='num'>Files</th><th scope='col' class='num'>Lines</th><th scope='col' class='num'>Size</th></tr></thead>";
    const pb = document.createElement("tbody");
    for (const r of data.breakdowns.projectLines) {
      const tr = document.createElement("tr");
      const tdSlug = document.createElement("td");
      tdSlug.className = "ellipsis";
      tdSlug.title = r.slug;
      tdSlug.textContent = r.slug;
      const tdFiles = document.createElement("td");
      tdFiles.className = "num";
      tdFiles.textContent = fmt(r.files);
      const tdLines = document.createElement("td");
      tdLines.className = "num";
      tdLines.textContent = fmt(r.lines);
      const tdBytes = document.createElement("td");
      tdBytes.className = "num";
      tdBytes.textContent = fmtBytes(r.bytes);
      tr.appendChild(tdSlug);
      tr.appendChild(tdFiles);
      tr.appendChild(tdLines);
      tr.appendChild(tdBytes);
      pb.appendChild(tr);
    }
    pt.appendChild(pb);
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    wrap.setAttribute("tabindex", "0");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Workspaces table");
    wrap.appendChild(pt);
    proj.appendChild(wrap);
  }
}
document.getElementById("range-bar").addEventListener("click", (e) => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  currentRange = btn.getAttribute("data-range");
  setRangeUI(currentRange);
  renderTrendCharts();
});
document.getElementById("reload").addEventListener("click", loadAll);
loadAll();
