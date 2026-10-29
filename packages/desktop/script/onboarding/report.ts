// The run's artifacts: report.json for machines, index.html to watch the video against the invariants.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { INVARIANTS, type Outcome } from "./invariants"

export type Report = {
  passed: boolean
  build: { app: string; label: string; platform: string; installer?: string }
  startedAt: string
  /** Epoch ms of the first video frame; invariant times are relative to launch. */
  videoStart?: number
  launchedAt: number
  outcomes: Outcome[]
  facts: Record<string, string | number | boolean | null | undefined>
  errors: string[]
  videos: { clean?: string; annotated?: string; installer?: string; full?: string; failure?: string }
  logs: string[]
}

export function writeReport(dir: string, report: Report) {
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(dir, "index.html"), html(report))
}

const MARKS = { passed: "pass", failed: "FAIL", skipped: "skip" } satisfies Record<Outcome["status"], string>

export function summary(report: Report) {
  const rows = INVARIANTS.map((invariant) => {
    const outcome = report.outcomes.find((item) => item.id === invariant.id)
    const mark = MARKS[outcome?.status ?? "skipped"]
    const at = outcome?.at === undefined ? "" : `${(outcome.at / 1000).toFixed(1)}s`

    return `  ${mark.padEnd(5)}${at.padStart(7)}  ${invariant.title}${outcome?.detail ? `\n${" ".repeat(16)}${outcome.detail}` : ""}`
  })

  return [`${report.passed ? "PASSED" : "FAILED"}  ${report.build.label}`, ...rows].join("\n")
}

function html(report: Report) {
  const data = JSON.stringify({ report, invariants: INVARIANTS }).replace(/</g, "\\u003c")
  const video = report.videos.annotated ?? report.videos.clean

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${report.passed ? "Passed" : "Failed"} · Onboarding · ${escape(report.build.label)}</title>
<style>
:root { color-scheme: light dark; --bg: #fff; --panel: #fafafa; --line: #e5e5e5; --text: #171717; --muted: #737373; --accent: #009fff; --ok: #1a7f37; --warn: #9a6700; --err: #cf222e; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --panel: #111; --line: #262626; --text: #ededed; --muted: #8a8a8a; --ok: #3fb950; --warn: #d29922; --err: #f85149; } }
* { box-sizing: border-box; margin: 0; }
body { background: var(--bg); color: var(--text); font: 13px/18px system-ui, sans-serif; }
.mono { font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
header { position: sticky; top: 0; z-index: 1; height: 40px; display: flex; align-items: center; gap: 12px; padding: 0 16px; background: var(--bg); border-bottom: 1px solid var(--line); }
header h1 { font-size: 13px; font-weight: 600; }
.pill { padding: 0 6px; border: 1px solid currentColor; }
.passed { color: var(--ok); } .failed { color: var(--err); } .skipped { color: var(--muted); }
main { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 16px; padding: 16px; }
@media (max-width: 1000px) { main { grid-template-columns: 1fr; } }
video { width: 100%; display: block; background: #000; border: 1px solid var(--line); }
.track { position: relative; height: 24px; margin-top: 8px; border: 1px solid var(--line); background: var(--panel); cursor: pointer; }
.track .head { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--accent); }
.track .mark { position: absolute; top: 4px; width: 9px; height: 14px; margin-left: -4px; border: 1px solid currentColor; background: var(--bg); }
.list { border: 1px solid var(--line); }
.row { display: grid; grid-template-columns: 52px 1fr 56px; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--line); cursor: pointer; }
.row:first-child { border-top: 0; }
.row:hover { background: var(--panel); }
.row.current { box-shadow: inset 2px 0 var(--accent); }
.row .why, .row .detail { color: var(--muted); }
.row .detail.failed { color: var(--err); }
.row .time { text-align: right; color: var(--muted); }
h2 { font-size: 13px; font-weight: 600; margin: 16px 0 8px; }
table { width: 100%; border-collapse: collapse; border: 1px solid var(--line); }
td { padding: 4px 12px; border-top: 1px solid var(--line); vertical-align: top; word-break: break-word; }
td:first-child { color: var(--muted); width: 40%; }
.tabs { display: flex; gap: 0; margin-bottom: 8px; }
.tabs button { font: inherit; color: var(--muted); background: var(--bg); border: 1px solid var(--line); padding: 2px 10px; cursor: pointer; margin-left: -1px; }
.tabs button.on { color: var(--text); border-color: var(--accent); position: relative; }
pre { white-space: pre-wrap; padding: 8px 12px; border: 1px solid var(--line); background: var(--panel); }
a { color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>First-launch onboarding</h1>
  <span class="mono">${escape(report.build.label)} · ${escape(report.build.platform)}</span>
  <span class="pill mono ${report.passed ? "passed" : "failed"}">${report.passed ? "PASSED" : "FAILED"}</span>
  <span class="mono" style="margin-left:auto;color:var(--muted)">${escape(report.startedAt)}</span>
</header>
<main>
  <section>
    <div class="tabs" id="tabs"></div>
    ${video ? `<video id="video" src="${escape(video)}" controls autoplay muted playsinline></video><div class="track" id="track"><div class="head" id="head"></div></div>` : `<pre>No video: ffmpeg was not available.</pre>`}
    <h2>Reply</h2>
    <pre class="mono">${escape(String(report.facts.reply ?? "—"))}</pre>
    ${report.errors.length ? `<h2>Renderer errors</h2><pre class="mono">${escape(report.errors.join("\n"))}</pre>` : ""}
  </section>
  <aside>
    <div class="list" id="list"></div>
    <h2>Run</h2>
    <table class="mono" id="facts"></table>
    <h2>Files</h2>
    <p class="mono"><a href="report.json">report.json</a>${report.logs.map((log) => ` · <a href="${escape(log)}">${escape(log)}</a>`).join("")}</p>
  </aside>
</main>
<script>
const { report, invariants } = ${data}
const video = document.getElementById("video")
const list = document.getElementById("list")
const track = document.getElementById("track")
const offset = report.videoStart === undefined ? 0 : (report.videoStart - report.launchedAt) / 1000
const at = (outcome) => (outcome?.at === undefined ? undefined : Math.max(0, outcome.at / 1000 - offset))
const rows = invariants.map((invariant) => {
  const outcome = report.outcomes.find((item) => item.id === invariant.id) ?? { status: "skipped" }
  const row = document.createElement("div")
  row.className = "row"
  row.innerHTML = '<span class="mono ' + outcome.status + '">' + outcome.status.toUpperCase() + '</span>' +
    '<div><div>' + invariant.title + '</div><div class="why">' + invariant.why + '</div>' +
    (outcome.detail ? '<div class="detail mono ' + outcome.status + '">' + outcome.detail.replace(/[<&]/g, (c) => c === "<" ? "&lt;" : "&amp;") + '</div>' : "") + '</div>' +
    '<span class="time mono">' + (outcome.at === undefined ? "" : "+" + (outcome.at / 1000).toFixed(1) + "s") + '</span>'
  row.onclick = () => { if (video && at(outcome) !== undefined) { video.currentTime = Math.max(0, at(outcome) - 1); video.play() } }
  list.append(row)
  if (track && at(outcome) !== undefined) {
    const mark = document.createElement("div")
    mark.className = "mark " + outcome.status
    mark.title = invariant.title
    mark.dataset.at = at(outcome)
    track.append(mark)
  }
  return { row, time: at(outcome) }
})
if (video) {
  const place = () => {
    if (!video.duration) return
    document.getElementById("head").style.left = (video.currentTime / video.duration) * 100 + "%"
    track.querySelectorAll(".mark").forEach((mark) => (mark.style.left = (Number(mark.dataset.at) / video.duration) * 100 + "%"))
    const current = rows.filter((item) => item.time !== undefined && item.time <= video.currentTime).at(-1)
    rows.forEach((item) => item.row.classList.toggle("current", item === current))
  }
  video.addEventListener("timeupdate", place)
  video.addEventListener("loadedmetadata", place)
  track.onclick = (event) => { const box = track.getBoundingClientRect(); video.currentTime = ((event.clientX - box.left) / box.width) * video.duration }
  const sources = [["Annotated", report.videos.annotated], ["Clean", report.videos.clean], ["Installer + app", report.videos.full]].filter(([, src]) => src)
  const tabs = document.getElementById("tabs")
  sources.forEach(([name, src]) => {
    const button = document.createElement("button")
    button.textContent = name
    button.className = video.getAttribute("src") === src ? "on" : ""
    button.onclick = () => { video.src = src; tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === button)) }
    tabs.append(button)
  })
}
const facts = document.getElementById("facts")
Object.entries(report.facts).filter(([key]) => key !== "reply").forEach(([key, value]) => {
  const row = facts.insertRow()
  row.insertCell().textContent = key
  row.insertCell().textContent = value === undefined || value === null ? "—" : String(value)
})
</script>
</body>
</html>
`
}

function escape(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char)
}
