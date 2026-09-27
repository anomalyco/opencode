import { Option, Schema } from "effect"

/**
 * Browser recording — Fase 5 (browser recording).
 *
 * The browser driver records every action it executes (timestamp, action,
 * parameters, result, errors, final URL, screenshot) plus cumulative console
 * and network buffers for the whole session. This module owns the recording's
 * public shape and renders it as the "Browser Test Recording" artifact: one
 * self-contained HTML file that serves as visual evidence of a browser
 * session — timeline, embedded screenshots, console, network, and errors.
 *
 * The JSON recording (same payload) is the replay input: action `replay`
 * re-executes the recorded steps through the normal tool path, so validation
 * and permissions apply exactly as they did live.
 */

export const Step = Schema.Struct({
  at: Schema.Number,
  action: Schema.String,
  params: Schema.Unknown,
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
  output: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  shot: Schema.optional(Schema.String),
}).annotate({ identifier: "BrowserRecordingStep" })
export type Step = Schema.Schema.Type<typeof Step>

export const ConsoleEntry = Schema.Struct({
  at: Schema.Number,
  type: Schema.String,
  text: Schema.String,
  url: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
}).annotate({ identifier: "BrowserRecordingConsoleEntry" })

export const NetworkEntry = Schema.Struct({
  at: Schema.Number,
  method: Schema.String,
  url: Schema.String,
  resourceType: Schema.String,
  ok: Schema.Boolean,
  status: Schema.optional(Schema.Number),
  failure: Schema.optional(Schema.String),
}).annotate({ identifier: "BrowserRecordingNetworkEntry" })

export const Recording = Schema.Struct({
  version: Schema.Number,
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  url: Schema.optional(Schema.String),
  steps: Schema.Array(Step),
  console: Schema.Array(ConsoleEntry),
  network: Schema.Array(NetworkEntry),
}).annotate({ identifier: "BrowserRecording" })
export type Recording = Schema.Schema.Type<typeof Recording>

/** Parses a recording payload (driver JSON or a saved recording file).
 *  Anything that is not a Browser Test Recording decodes to none — never to a
 *  partial recording (Fase 40: no half-simulated evidence). */
export const decode = (text: string) => {
  const json = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(text)
  if (!Option.isSome(json)) return Option.none()
  const decoded = Schema.decodeUnknownOption(Recording)(json.value)
  if (!Option.isSome(decoded)) return Option.none()
  return decoded
}

/** The "Browser Test Recording" artifact: one offline HTML document. All user
 *  data (outputs, params, console text, URLs) is escaped so recorded page HTML
 *  can never inject markup into the evidence. */
export const render = (recording: Recording): string => {
  const end = recording.endedAt ?? recording.steps[recording.steps.length - 1]?.at ?? recording.startedAt
  const duration = ((end - recording.startedAt) / 1000).toFixed(1)
  const ok = recording.steps.filter((step) => step.ok).length
  const failed = recording.steps.length - ok
  const shots = recording.steps.filter((step) => step.shot !== undefined).length
  const errors = [
    ...recording.steps
      .filter((step) => !step.ok)
      .map((step) => ({ at: step.at, text: `${step.action}: ${step.error ?? "unknown error"}` })),
    ...recording.console
      .filter((entry) => entry.type === "pageerror")
      .map((entry) => ({ at: entry.at, text: `pageerror: ${entry.text}` })),
  ]
  const rows = recording.steps.map((step, index) => stepRow(step, index, recording.startedAt)).join("\n")
  const consoleRows = recording.console
    .map(
      (entry) => `      <tr>
        <td class="ts">${stamp(entry.at)}</td>
        <td class="${entry.type === "pageerror" || entry.type === "error" ? "bad" : ""}">${escape(entry.type)}</td>
        <td>${escape(entry.text)}${
          entry.url === undefined ? "" : ` <span class="dim">${escape(entry.url)}:${entry.line ?? 0}</span>`
        }</td>
      </tr>`,
    )
    .join("\n")
  const networkRows = recording.network
    .map(
      (entry) => `      <tr>
        <td class="ts">${stamp(entry.at)}</td>
        <td class="${entry.ok ? "good" : "bad"}">${escape(entry.method)}</td>
        <td>${escape(entry.url)}</td>
        <td class="${entry.ok ? "good" : "bad"}">${
          entry.ok ? String(entry.status ?? "ok") : escape(entry.failure ?? `HTTP ${entry.status ?? "failed"}`)
        }</td>
        <td>${escape(entry.resourceType)}</td>
      </tr>`,
    )
    .join("\n")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Browser Test Recording</title>
<style>
  * { box-sizing: border-box }
  body { margin: 0; background: #f4f5f7; color: #14181f; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif }
  header { background: #0f1419; color: #e8eaed; padding: 26px 32px }
  h1 { margin: 0 0 6px; font-size: 21px }
  .meta { margin: 0; color: #9aa4b2; font: 12px/1.6 ui-monospace, "Cascadia Mono", monospace; word-break: break-all }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px }
  .pill { border: 1px solid #2a3441; background: #1c2430; color: #cfd6de; border-radius: 999px; padding: 2px 11px; font-size: 12px }
  .pill.bad { background: #3a1418; border-color: #5c2026; color: #ffb4b4 }
  main { max-width: 1080px; margin: 0 auto; padding: 8px 32px 32px }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #5b6673; margin: 30px 0 12px }
  .empty { color: #8a94a1; font-size: 13px }
  ol.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px }
  .step { background: #fff; border: 1px solid #dfe3e8; border-left: 4px solid #2f9e5f; border-radius: 10px; padding: 11px 14px }
  .step.failed { border-left-color: #d14343 }
  .head { display: flex; flex-wrap: wrap; gap: 9px; align-items: baseline; font-size: 13px }
  .n { color: #8a94a1; min-width: 1.6em; text-align: right; font-variant-numeric: tabular-nums }
  .ts { color: #8a94a1; font: 12px ui-monospace, "Cascadia Mono", monospace }
  code { background: #eef1f4; border-radius: 5px; padding: 1px 7px; font-weight: 600 }
  .params { color: #4a5563; font: 12px ui-monospace, "Cascadia Mono", monospace; word-break: break-all }
  .badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; border-radius: 5px; padding: 1px 8px }
  .badge.ok { background: #e3f5ea; color: #1d7a48 }
  .badge.err { background: #fdeaea; color: #b42c2c }
  .dim { color: #5b6673; font-size: 12px; word-break: break-all }
  pre { background: #f7f8fa; border: 1px solid #e6e9ed; border-radius: 8px; padding: 9px 12px; margin: 10px 0 0; font: 12px/1.5 ui-monospace, "Cascadia Mono", monospace; white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto }
  pre.error { background: #fdf1f1; border-color: #f3c9c9; color: #8f2626; max-height: none }
  img.shot { display: block; margin-top: 12px; max-width: 100%; border: 1px solid #d7dce2; border-radius: 8px; background: #fff }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dfe3e8; border-radius: 10px; overflow: hidden; font-size: 13px }
  th, td { text-align: left; padding: 7px 12px; border-bottom: 1px solid #eef0f3; vertical-align: top; word-break: break-all }
  th { background: #f7f8fa; color: #5b6673; font-size: 11px; text-transform: uppercase; letter-spacing: .06em }
  tr:last-child td { border-bottom: none }
  td.ts { white-space: nowrap }
  .good { color: #1d7a48 }
  .bad { color: #b42c2c }
  footer { color: #8a94a1; font-size: 12px; text-align: center; padding: 6px 32px 30px }
  @media print { body { background: #fff } header { background: #fff; color: #000; border-bottom: 2px solid #000 } .meta { color: #444 } .pill { background: #fff; border-color: #999; color: #000 } }
</style>
</head>
<body>
<header>
  <h1>Browser Test Recording</h1>
  <p class="meta">started ${new Date(recording.startedAt).toISOString()} · duration ${duration}s${
    recording.url === undefined ? "" : ` · final url ${escape(recording.url)}`
  }</p>
  <div class="pills">
    <span class="pill">${recording.steps.length} steps</span>
    <span class="pill">${ok} ok</span>
    <span class="pill${failed > 0 ? " bad" : ""}">${failed} failed</span>
    <span class="pill">${shots} screenshots</span>
    <span class="pill">${recording.console.length} console</span>
    <span class="pill">${recording.network.length} network</span>
  </div>
</header>
<main>
  <h2>Timeline</h2>
  <ol class="steps">
${rows}
  </ol>

  <h2>Errors (${errors.length})</h2>
  ${
    errors.length === 0
      ? '<p class="empty">No errors recorded.</p>'
      : `<ol class="steps">${errors
          .map(
            (error) =>
              `  <li class="step failed"><div class="head"><span class="ts">${stamp(error.at)}</span><span>${escape(
                error.text,
              )}</span></div></li>`,
          )
          .join("\n")}</ol>`
  }

  <h2>Console (${recording.console.length})</h2>
  ${
    recording.console.length === 0
      ? '<p class="empty">No console messages recorded.</p>'
      : `  <table>
    <tr><th>time</th><th>type</th><th>message</th></tr>
${consoleRows}
  </table>`
  }

  <h2>Network (${recording.network.length})</h2>
  ${
    recording.network.length === 0
      ? '<p class="empty">No network activity recorded.</p>'
      : `  <table>
    <tr><th>time</th><th>method</th><th>url</th><th>outcome</th><th>type</th></tr>
${networkRows}
  </table>`
  }
</main>
<footer>opencode browser tool · recording version ${recording.version} · artifact generated ${new Date().toISOString()}</footer>
</body>
</html>
`
}

const escape = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const stamp = (at: number) => new Date(at).toISOString().slice(11, 23)

const stepRow = (step: Step, index: number, startedAt: number) => {
  const params = escape(JSON.stringify(step.params) ?? "{}")
  const offset = ((step.at - startedAt) / 1000).toFixed(1)
  return `    <li class="step${step.ok ? "" : " failed"}">
      <div class="head"><span class="n">${index + 1}</span><span class="ts">+${offset}s ${stamp(step.at)}</span><code>${escape(
        step.action,
      )}</code><span class="params">${params}</span><span class="badge ${step.ok ? "ok" : "err"}">${
        step.ok ? "ok" : "error"
      }</span>${step.url === undefined ? "" : `<span class="dim">${escape(step.url)}</span>`}</div>${
        step.output === undefined ? "" : `\n      <pre>${escape(step.output)}</pre>`
      }${step.error === undefined ? "" : `\n      <pre class="error">${escape(step.error)}</pre>`}${
        step.shot === undefined
          ? ""
          : `\n      <img class="shot" src="${escape(step.shot)}" alt="Screenshot after ${escape(step.action)}">`
      }
    </li>`
}

export * as BrowserRecording from "./browser-recording"
