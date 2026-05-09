import type { Aggregate, Sections } from "./schema"

const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC_MAP[c]!)

/**
 * Inline-markdown renderer for LLM-authored narrative text.
 *
 * Supports the small subset the section prompts actually request:
 *   - `**bold**`           → <strong>
 *   - `*italic*` / `_em_`  → <em>
 *   - `` `code` ``         → <code>
 *
 * The order of operations matters: we HTML-escape the entire input first
 * (so anything we don't transform stays safe), then unescape exactly the
 * pairs we recognise back into tags. Code spans are processed before
 * emphasis so backticks inside text don't get partially-italicised.
 *
 * Use this for short *single-line* narrative strings. For full markdown
 * blocks (headings, lists, paragraphs) use `renderMarkdown` instead.
 */
function renderInline(s: string): string {
  const normalized = s.replace(/\r\n?/g, "\n")
  return esc(normalized)
    .replace(/`([^`]+?)`/g, (_m, body: string) => `<code>${body}</code>`)
    .replace(/\*\*([^*\n][^*\n]*?)\*\*/g, (_m, body: string) => `<strong>${body}</strong>`)
    .replace(/(^|[\s(])\*([^*\n]+?)\*(?=$|[\s.,;:!?)])/g, (_m, lead: string, body: string) => `${lead}<em>${body}</em>`)
    .replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s.,;:!?)])/g, (_m, lead: string, body: string) => `${lead}<em>${body}</em>`)
}

/**
 * Block-level markdown renderer for fields the LLM may return as full
 * documents (e.g. `suggestions.agents_md_additions[].addition`).
 *
 * Supports:
 *   - fenced code blocks (```lang\n...\n```)        → <pre><code>...</code></pre>
 *   - ATX headings (##, ###, ####)                  → <h3>/<h4>/<h5>
 *     (`#` is downgraded to <h3> too — h1/h2 are reserved for the report
 *      shell and section headers)
 *   - unordered lists (-, *, +) including multi-line items joined by
 *     continuation indent or single newline                → <ul><li>...</li></ul>
 *   - ordered lists (1. 2. ...)                            → <ol><li>...</li></ol>
 *   - blank-line-separated paragraphs                      → <p>
 *
 * Inline pass (bold/em/code) runs on every text fragment via `renderInline`.
 *
 * Not supported (kept simple on purpose): blockquotes, tables, nested lists,
 * setext headings, inline HTML, links. The LLM prompts in `sections.ts`
 * never ask for these.
 */
function renderMarkdown(input: string): string {
  // 0. Normalize CRLF / lone CR to LF so block-split + line-marker regexes
  //    don't have a stray \r tagging along on each line. Also strip stray
  //    NUL bytes — we use \u0000 as the code-fence-stash sentinel below, so
  //    any NULs in the input could collide with our placeholders.
  const normalized = input.replace(/\r\n?/g, "\n").replace(/\u0000/g, "")

  // 1. Pull fenced code blocks out first so their internals don't get
  //    re-interpreted as headings / lists.
  const codeBlocks: string[] = []
  const stashed = normalized.replace(/```[a-zA-Z0-9_+-]*\n([\s\S]*?)```/g, (_m, body: string) => {
    codeBlocks.push(body.replace(/\n$/, ""))
    return `\u0000CODE${codeBlocks.length - 1}\u0000`
  })

  // 2. Split into blocks separated by blank lines.
  const rawBlocks = stashed.split(/\n\s*\n+/).map((b) => b.replace(/^\n+|\n+$/g, ""))

  const ulMarker = /^(\s*)([-*+])\s+(.*)$/
  const olMarker = /^(\s*)(\d+)\.\s+(.*)$/
  const headingMarker = /^(#{1,4})\s+(.+)$/

  // Render a sequence of list lines (items + their continuations) into <ul>/<ol>.
  const renderListLines = (lines: string[], isUL: boolean): string => {
    const marker = isUL ? ulMarker : olMarker
    const items: string[] = []
    const current: string[] = []
    const flush = () => {
      if (current.length === 0) return
      items.push(current.join(" ").trim())
      current.length = 0
    }
    for (const line of lines) {
      const m = marker.exec(line)
      if (m) {
        flush()
        current.push(m[3]!)
        continue
      }
      const trimmed = line.trim()
      if (trimmed) current.push(trimmed)
    }
    flush()
    const tag = isUL ? "ul" : "ol"
    return `<${tag}>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</${tag}>`
  }

  // Split a single block (no blank lines inside) into mini-segments by line
  // type — headings, lists, paragraphs can interleave without blank-line
  // separation in real-world LLM output.
  const renderBlock = (block: string): string => {
    if (!block) return ""

    // Code-block placeholder?
    const codeMatch = /^\u0000CODE(\d+)\u0000$/.exec(block)
    if (codeMatch) {
      const idx = Number(codeMatch[1])
      return `<pre><code>${esc(codeBlocks[idx] ?? "")}</code></pre>`
    }

    const lines = block.split("\n")
    const out: string[] = []
    type Mode = "para" | "ul" | "ol"
    const buf: { mode: Mode; lines: string[] } = { mode: "para", lines: [] }
    const flushBuf = () => {
      if (buf.lines.length === 0) return
      if (buf.mode === "para") {
        out.push(`<p>${renderInline(buf.lines.join("\n")).replace(/\n/g, "<br>")}</p>`)
        buf.lines = []
        return
      }
      out.push(renderListLines(buf.lines, buf.mode === "ul"))
      buf.lines = []
    }

    for (const line of lines) {
      // Heading line — flush, emit, reset to paragraph mode.
      const hm = headingMarker.exec(line)
      if (hm) {
        flushBuf()
        const level = Math.min(5, Math.max(3, hm[1]!.length + 2))
        out.push(`<h${level}>${renderInline(hm[2]!)}</h${level}>`)
        buf.mode = "para"
        continue
      }
      const isUL = ulMarker.test(line)
      const isOL = !isUL && olMarker.test(line)
      const lineMode: Mode = isUL ? "ul" : isOL ? "ol" : "para"
      // Indented continuation of an active list item: keep it in list mode so
      // `renderListLines` can fold it into the previous <li>.
      const isContinuation =
        (buf.mode === "ul" || buf.mode === "ol") &&
        lineMode === "para" &&
        line.trim() !== "" &&
        /^\s+\S/.test(line)
      if (isContinuation) {
        buf.lines.push(line)
        continue
      }
      // Mode change → flush previous group.
      if (lineMode !== buf.mode && buf.lines.length > 0) flushBuf()
      buf.mode = lineMode
      // Skip lines that are pure whitespace (already trimmed by outer split,
      // but inner lines may be empty).
      if (lineMode === "para" && line.trim() === "" && buf.lines.length === 0) continue
      buf.lines.push(line)
    }
    flushBuf()
    return out.join("")
  }

  return rawBlocks.map(renderBlock).join("\n")
}

const LOGO_SVG = String.raw`
<svg class="logo" viewBox="0 0 234 42" xmlns="http://www.w3.org/2000/svg" aria-label="opencode">
  <path class="fg-weak"   d="M18 30H6V18H18V30Z"/>
  <path class="fg-strong" d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z"/>
  <path class="fg-weak"   d="M48 30H36V18H48V30Z"/>
  <path class="fg-strong" d="M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z"/>
  <path class="fg-weak"   d="M84 24V30H66V24H84Z"/>
  <path class="fg-strong" d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z"/>
  <path class="fg-weak"   d="M108 36H96V18H108V36Z"/>
  <path class="fg-strong" d="M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z"/>
  <path class="fg-weak"   d="M144 30H126V18H144V30Z"/>
  <path class="fg-strong" d="M144 12H126V30H144V36H120V6H144V12Z"/>
  <path class="fg-weak"   d="M168 30H156V18H168V30Z"/>
  <path class="fg-strong" d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z"/>
  <path class="fg-weak"   d="M198 30H186V18H198V30Z"/>
  <path class="fg-strong" d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z"/>
  <path class="fg-weak"   d="M234 24V30H216V24H234Z"/>
  <path class="fg-strong" d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z"/>
</svg>`

const CSS = String.raw`
  /* OpenCode share/docs design tokens (light) */
  :root {
    color-scheme: light dark;

    --bg:               hsl(0, 20%, 99%);
    --bg-weak:          hsl(0, 8%, 97%);
    --bg-weak-hover:    hsl(0, 8%, 94%);
    --bg-strong:        hsl(0, 5%, 12%);
    --bg-interactive:   hsl(62, 84%, 88%);

    --fg:               hsl(0, 1%, 39%);
    /* --fg-weak darkened from L=60% to L=46% to clear WCAG AA (~4.5:1) on
       the warm-near-white --bg in body-text contexts. */
    --fg-weak:          hsl(0, 1%, 46%);
    --fg-weaker:        hsl(0, 3%, 88%);
    --fg-strong:        hsl(0, 5%, 12%);

    --border:           hsl(30, 2%, 81%);
    --border-weak:      hsl(0, 1%, 85%);

    /* semantic (synthesized to fit the warm palette) */
    --accent:           hsl(0, 5%, 12%);
    --accent-soft:      hsl(62, 84%, 88%);
    --good:             hsl(140, 45%, 38%);
    --warn:             hsl(28,  85%, 48%);
    --danger:           hsl(8,   78%, 52%);

    --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg:             hsl(0, 9%, 7%);
      --bg-weak:        hsl(0, 6%, 10%);
      --bg-weak-hover:  hsl(0, 6%, 14%);
      --bg-strong:      hsl(0, 15%, 94%);
      --bg-interactive: hsl(62, 100%, 90%);

      --fg:             hsl(0, 4%, 71%);
      /* L=49 → 60 to clear WCAG AA (~4.9:1) on the dark --bg. */
      --fg-weak:        hsl(0, 2%, 60%);
      --fg-weaker:      hsl(0, 3%, 28%);
      --fg-strong:      hsl(0, 15%, 94%);

      --border:         hsl(0, 3%, 28%);
      --border-weak:    hsl(0, 4%, 23%);

      --accent:         hsl(0, 15%, 94%);
      --accent-soft:    hsl(62, 100%, 90%);
      --good:           hsl(140, 45%, 60%);
      --warn:           hsl(38,  90%, 60%);
      --danger:         hsl(8,   78%, 64%);
    }
  }

  * { box-sizing: border-box; }

  body {
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.6875;
    background: var(--bg);
    color: var(--fg);
    max-width: 960px;
    margin: 2.5rem auto;
    padding: 0 1.5rem;
    -webkit-font-smoothing: antialiased;
  }

  /* Header / brand */
  header.report-head { display: flex; align-items: center; gap: 1.25rem; margin-bottom: 2rem; }
  header.report-head .logo {
    height: 28px;
    width: auto;
    flex: 0 0 auto;       /* never shrink — text in the sibling can wrap freely */
    align-self: flex-start;
    margin-top: .25rem;
  }
  header.report-head .logo .fg-strong { fill: var(--fg-strong); }
  header.report-head .logo .fg-weak   { fill: var(--fg-weaker); }
  header.report-head .head-body { min-width: 0; }   /* allow flex-child to shrink + wrap */
  header.report-head .meta { color: var(--fg-weak); font-size: 13px; }

  h1, h2, h3, h4 { font-weight: 500; color: var(--fg-strong); line-height: 1.2; letter-spacing: -0.01em; }
  h1 { font-size: 26px; margin: 0 0 .25rem 0; }
  h2 { font-size: 22px; margin: 2.5rem 0 1rem 0; padding-bottom: .5rem; border-bottom: 1px solid var(--border-weak); }
  h3 { font-size: 18px; margin: 1.5rem 0 .5rem 0; }
  h4 { font-size: 16px; margin: 1rem 0 .25rem 0; }
  strong { font-weight: 500; color: var(--fg-strong); }

  .muted { color: var(--fg-weak); }

  .grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }

  /* Cards: flat, hairline border, no shadow.
     '.card + .card' adds breathing room between consecutive cards (e.g.
     multiple AGENTS.md additions stacked vertically). The grid layout (used
     in "At a glance") already provides its own gap, so this only affects
     stacked siblings. */
  .card {
    background: var(--bg-weak);
    border: 1px solid var(--border-weak);
    border-radius: 4px;
    padding: 1rem 1.25rem;
  }
  /* Vertical breathing room ONLY between stacked sibling cards (e.g. multiple
     AGENTS.md additions). Cards inside .grid (the "At a glance" tiles) are
     already spaced via gap and must NOT get extra top-margin — that would
     push the second-row cards down and make the first card look taller under
     align-items: stretch. */
  *:not(.grid) > .card + .card { margin-top: .75rem; }
  /* Markdown lists inside a card need extra indent so ordered-list numbers
     don't collide with the card's left padding. Same for paragraphs after
     the muted intro line. */
  .card ul, .card ol { padding-left: 1.75rem; margin: .5rem 0; }
  .card > p { margin: .5rem 0; }
  .card > h4, .card > h5 { margin-top: .75rem; }
  .card > h4:first-child, .card > h5:first-child, .card > p:first-child { margin-top: 0; }
  .card > .muted + h4, .card > .muted + h5, .card > .muted + p { margin-top: .75rem; }
  .stat { font-size: 1.6rem; font-weight: 500; color: var(--fg-strong); margin-top: .25rem; }

  /* Bar rows: dark-fg fill on light bg, light-fg fill on dark bg.
     The label column has a hard min:0 + overflow ellipsis so long keys like
     'security_audit_and_hardening' truncate inside their column rather than
     spilling over the track. The full label stays available via title=. */
  .bar-row { display: grid; grid-template-columns: minmax(0, 18ch) 1fr 8ch; align-items: center; gap: .75rem; margin: .35rem 0; font-size: 13px; }
  .bar-row > .muted {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar-track { background: var(--bg-weak); border: 1px solid var(--border-weak); border-radius: 3px; height: 14px; overflow: hidden; }
  .bar { height: 100%; background: var(--accent); border-radius: 0; min-width: 2px; }
  .bar.warn { background: var(--warn); }
  .bar.good { background: var(--good); }

  /* Hour histogram: brand "interactive" yellow-green */
  .hours { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; align-items: end; height: 80px; margin: .5rem 0; }
  .hours .h { background: var(--accent-soft); border: 1px solid var(--border-weak); border-radius: 0; min-height: 1px; }
  .hours-labels { display: grid; grid-template-columns: repeat(24, 1fr); font-size: 11px; color: var(--fg-weak); text-align: center; }

  details > summary {
    cursor: pointer;
    padding: .5rem 0;
    font-weight: 500;
    color: var(--fg-strong);
    list-style: none;
  }
  /* Triangles use CSS unicode escapes (\\25B8 / \\25BE with trailing space)
     instead of literal ▸ / ▾ characters. Reason: Bun's String.raw transpiles
     non-ASCII characters in raw template literals to their JS escape form
     (\u25B8), which the browser renders as the literal text "u25B8" rather
     than the glyph. CSS escapes survive the round-trip cleanly. */
  details > summary::before { content: "\25B8 "; color: var(--fg-weak); }
  details[open] > summary::before { content: "\25BE "; }

  ul, ol { padding-left: 1.25rem; }
  li { margin: .125rem 0; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid var(--border-weak); }
  th { font-weight: 500; color: var(--fg-strong); }

  pre, code { font-family: var(--font-mono); }
  pre {
    background: var(--bg-weak);
    border: 1px solid var(--border-weak);
    padding: .75rem 1rem;
    border-radius: 6px;
    overflow-x: auto;
    white-space: pre-wrap;
    font-size: 13px;
    line-height: 1.55;
    margin: .5rem 0;
  }
  /* Inside cards 'pre' already lives on a contrasting bg of its own; keep its
     margin so consecutive prompt-scaffold + example_code blocks don't merge. */
  .card pre + pre { margin-top: .5rem; }

  .pill {
    display: inline-block;
    padding: .15rem .55rem;
    border-radius: 999px;
    background: var(--bg-weak);
    border: 1px solid var(--border-weak);
    color: var(--fg);
    font-size: 12px;
    margin: .15rem .15rem 0 0;
  }
  .pill.accent { background: var(--bg-interactive); border-color: transparent; color: var(--fg-strong); }

  .ok    { color: var(--good); }
  .warn  { color: var(--warn); }
  .danger{ color: var(--danger); }

  .banner {
    background: var(--bg-weak);
    border: 1px solid var(--border-weak);
    border-left: 2px solid var(--bg-strong);
    border-radius: 4px;
    padding: 1rem 1.25rem;
  }

  .archive-group { margin: .5rem 0 1rem 0; }
  .archive-group h4 { margin: .5rem 0 .25rem 0; font-size: 14px; }
  .archive-list { margin: 0; padding-left: 1.25rem; }

  hr { border: none; border-top: 1px solid var(--border-weak); margin: 2rem 0; }

  a { color: var(--fg-strong); text-underline-offset: 3px; }
`

type Pair = readonly [string, number]

const sortDesc = (entries: Record<string, number>): Pair[] =>
  Object.entries(entries).sort((a, b) => b[1] - a[1])

const totalTokens = (a: Aggregate): number =>
  a.totals_tokens.input +
  a.totals_tokens.output +
  a.totals_tokens.reasoning +
  a.totals_tokens.cache_read +
  a.totals_tokens.cache_write

const renderBars = (entries: Pair[], limit: number): string => {
  const top = entries.slice(0, limit)
  const max = top.reduce((m, [, v]) => (v > m ? v : m), 0)
  return top
    .map(([label, value]) => {
      const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
      const safe = esc(label)
      return `<div class="bar-row"><div class="muted" title="${safe}">${safe}</div><div class="bar-track"><div class="bar" style="width:${pct}%"></div></div><div>${value.toLocaleString()}</div></div>`
    })
    .join("")
}

function renderAtAGlance(a: Aggregate): string {
  const total = totalTokens(a)
  const tpsAvg = a.total_sessions > 0 ? Math.round(total / a.total_sessions).toLocaleString() : "0"
  return `
<section>
  <h2>At a glance</h2>
  <div class="grid">
    <div class="card"><div class="muted">Sessions</div><div class="stat">${a.total_sessions.toLocaleString()}</div></div>
    <div class="card"><div class="muted">Days active</div><div class="stat">${a.days_active.toLocaleString()}</div></div>
    <div class="card"><div class="muted">Avg tokens/session</div><div class="stat">${tpsAvg}</div></div>
    <div class="card"><div class="muted">Total cost</div><div class="stat">$${a.total_cost.toFixed(2)}</div></div>
    <div class="card"><div class="muted">Multi-clauding events</div><div class="stat">${a.multi_clauding.overlap_events.toLocaleString()}</div></div>
  </div>
</section>`
}

function renderHoursHistogram(message_hours: number[]): string {
  const counts = new Array(24).fill(0) as number[]
  message_hours.forEach((h) => {
    // Guard against NaN/Infinity from upstream — Math.floor(NaN) is NaN, and
    // counts[NaN] writes to property "NaN" on the array (silent corruption).
    if (!Number.isFinite(h)) return
    const idx = Math.max(0, Math.min(23, Math.floor(h)))
    counts[idx] = (counts[idx] ?? 0) + 1
  })
  const max = counts.reduce((m, v) => (v > m ? v : m), 0)
  const bars = counts
    .map((c) => {
      const pct = max > 0 ? Math.max(1, Math.round((c / max) * 100)) : 0
      return `<div class="h" title="${c}" style="height:${pct}%"></div>`
    })
    .join("")
  const labels = Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? `<div>${i}</div>` : `<div></div>`)).join("")
  return `<div class="hours">${bars}</div><div class="hours-labels">${labels}</div>`
}

function renderHowYouUse(a: Aggregate): string {
  const goalEntries = sortDesc(a.goal_categories)
  const sessionTypes = sortDesc(a.session_types)
  const projectsEntries = Object.values(a.projects).sort((p1, p2) => p2.sessions - p1.sessions)
  const toolsEntries = sortDesc(a.tool_counts)
  const langEntries = sortDesc(a.languages)

  const goalBars = goalEntries.length > 0 ? renderBars(goalEntries, 10) : `<p class="muted">No data.</p>`
  const sessionTypePills =
    sessionTypes.length > 0
      ? sessionTypes
          .map(([k, v]) => `<span class="pill">${esc(k)} · ${v.toLocaleString()}</span>`)
          .join("")
      : `<p class="muted">No data.</p>`
  const projectRows =
    projectsEntries.length > 0
      ? projectsEntries
          .map(
            (p) =>
              `<tr><td>${esc(p.path)}</td><td>${esc(p.id)}</td><td>${p.sessions.toLocaleString()}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3" class="muted">No projects.</td></tr>`
  const toolBars = toolsEntries.length > 0 ? renderBars(toolsEntries, 10) : `<p class="muted">No tool calls recorded.</p>`
  const langBars = langEntries.length > 0 ? renderBars(langEntries, 10) : `<p class="muted">No languages detected.</p>`

  return `
<section>
  <h2>How you use OpenCode</h2>
  <h3>Goal categories</h3>
  ${goalBars}
  <h3>Session types</h3>
  <div>${sessionTypePills}</div>
  <h3>Projects</h3>
  <table><thead><tr><th>Path</th><th>ID</th><th>Sessions</th></tr></thead><tbody>${projectRows}</tbody></table>
  <h3>Time of day</h3>
  ${renderHoursHistogram(a.message_hours)}
  <h3>Top tools</h3>
  ${toolBars}
  <h3>Languages</h3>
  ${langBars}
</section>`
}

function renderInteractionStyle(s: NonNullable<Sections["interaction_style"]>): string {
  return `
<section>
  <h2>What makes your usage distinctive</h2>
  ${renderMarkdown(s.narrative)}
  ${s.key_pattern ? `<p><strong>${renderInline(s.key_pattern)}</strong></p>` : ""}
</section>`
}

function renderWhatWorks(s: NonNullable<Sections["what_works"]>): string {
  const items =
    s.impressive_workflows.length > 0
      ? `<ul>${s.impressive_workflows
          .map((w) => `<li><strong>${renderInline(w.title)}</strong> — ${renderInline(w.description)}</li>`)
          .join("")}</ul>`
      : ""
  return `
<section>
  <h2>What's working well</h2>
  ${renderMarkdown(s.intro)}
  ${items}
</section>`
}

function renderFriction(s: NonNullable<Sections["friction_analysis"]>): string {
  const cats =
    s.categories.length > 0
      ? s.categories
          .map((c) => {
            const examples =
              c.examples.length > 0
                ? `<ul>${c.examples.map((e) => `<li>${renderInline(e)}</li>`).join("")}</ul>`
                : ""
            return `<div class="card"><h3>${renderInline(c.category)}</h3>${renderMarkdown(c.description)}${examples}</div>`
          })
          .join("")
      : ""
  return `
<section>
  <h2>What to change</h2>
  ${renderMarkdown(s.intro)}
  ${cats}
</section>`
}

function renderSuggestions(s: NonNullable<Sections["suggestions"]>): string {
  // `addition` is frequently a multi-line markdown block (e.g. "## Heading\n- item\n- item").
  // `why` is shorter — keep as inline. `why_for_you` and `detail` are usually
  // 1-2 paragraphs, so render as block markdown too.
  const agentsMd =
    s.agents_md_additions.length > 0
      ? `<h3>AGENTS.md additions</h3>${s.agents_md_additions
          .map(
            (a) =>
              `<div class="card"><div class="muted">${renderInline(a.why)}</div>${renderMarkdown(a.addition)}${
                a.prompt_scaffold ? `<pre><code>${esc(a.prompt_scaffold)}</code></pre>` : ""
              }</div>`,
          )
          .join("")}`
      : ""
  const features =
    s.features_to_try.length > 0
      ? `<h3>Features to try</h3><ul>${s.features_to_try
          .map(
            (f) =>
              `<li><p><strong>${renderInline(f.feature)}</strong> — ${renderInline(f.one_liner)}</p><div class="muted">${renderMarkdown(f.why_for_you)}</div>${
                f.example_code ? `<pre><code>${esc(f.example_code)}</code></pre>` : ""
              }</li>`,
          )
          .join("")}</ul>`
      : ""
  const usage =
    s.usage_patterns.length > 0
      ? `<h3>Usage patterns</h3><ul>${s.usage_patterns
          .map(
            (u) =>
              `<li><p><strong>${renderInline(u.title)}</strong> — ${renderInline(u.suggestion)}</p>${renderMarkdown(u.detail)}${
                u.copyable_prompt ? `<pre><code>${esc(u.copyable_prompt)}</code></pre>` : ""
              }</li>`,
          )
          .join("")}</ul>`
      : ""
  return `
<section>
  <h2>Suggestions</h2>
  ${agentsMd}
  ${features}
  ${usage}
</section>`
}

function renderHorizon(s: NonNullable<Sections["on_the_horizon"]>): string {
  const items =
    s.opportunities.length > 0
      ? `<ul>${s.opportunities
          .map(
            (o) =>
              `<li><p><strong>${renderInline(o.title)}</strong></p>${renderMarkdown(o.whats_possible)}<div class="muted">${renderMarkdown(o.how_to_try)}</div>${
                o.copyable_prompt ? `<pre><code>${esc(o.copyable_prompt)}</code></pre>` : ""
              }</li>`,
          )
          .join("")}</ul>`
      : ""
  return `
<section>
  <h2>On the horizon</h2>
  ${renderMarkdown(s.intro)}
  ${items}
</section>`
}

function renderFunEnding(s: NonNullable<Sections["fun_ending"]>): string {
  return `
<section>
  <h2>Memorable moment</h2>
  <div class="banner"><h3>${renderInline(s.headline)}</h3>${renderMarkdown(s.detail)}</div>
</section>`
}

function renderArchive(a: Aggregate): string {
  const groups = new Map<string, Aggregate["session_summaries"]>()
  a.session_summaries.forEach((s) => {
    const key = s.project_path || "(unknown project)"
    const existing = groups.get(key) ?? []
    existing.push(s)
    groups.set(key, existing)
  })
  const sortedGroups = Array.from(groups.entries()).sort((a1, b1) => a1[0].localeCompare(b1[0]))
  const body =
    sortedGroups.length > 0
      ? sortedGroups
          .map(([projectPath, sessions]) => {
            const items = sessions
              .map((s) => {
                const outcome = s.outcome ? ` <span class="muted">— ${esc(s.outcome)}</span>` : ""
                const goal = s.goal ? ` <span class="muted">(${esc(s.goal)})</span>` : ""
                return `<li><code>${esc(s.id)}</code> · ${esc(s.started_iso)}${goal}: ${renderInline(s.summary)}${outcome}</li>`
              })
              .join("")
            return `<div class="archive-group"><h4>${esc(projectPath)} <span class="muted">(${sessions.length})</span></h4><ul class="archive-list">${items}</ul></div>`
          })
          .join("")
      : `<p class="muted">No sessions recorded.</p>`
  return `
<section>
  <h2>Session archive</h2>
  <details>
    <summary>${a.session_summaries.length.toLocaleString()} sessions</summary>
    ${body}
  </details>
</section>`
}

interface RenderInput {
  aggregate: Aggregate
  sections: Sections
  generated_at_iso: string
}

export function renderReport(input: RenderInput): string {
  const a = input.aggregate
  const dateRange = `${new Date(a.date_range.start_ms).toISOString().slice(0, 10)} → ${new Date(a.date_range.end_ms)
    .toISOString()
    .slice(0, 10)}`
  const personality = input.sections.interaction_style?.key_pattern ?? ""
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenCode — Usage ${esc(dateRange)}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">
<style>${CSS}</style>
</head><body>
<header class="report-head">
  ${LOGO_SVG}
  <div class="head-body">
    <h1>Your Usage Report</h1>
    <p class="meta">${esc(dateRange)} · ${a.total_sessions.toLocaleString()} sessions · generated ${esc(input.generated_at_iso)}</p>
    ${personality ? `<p>${renderInline(personality)}</p>` : ""}
  </div>
</header>
${renderAtAGlance(a)}
${renderHowYouUse(a)}
${input.sections.interaction_style ? renderInteractionStyle(input.sections.interaction_style) : ""}
${input.sections.what_works ? renderWhatWorks(input.sections.what_works) : ""}
${input.sections.friction_analysis ? renderFriction(input.sections.friction_analysis) : ""}
${input.sections.suggestions ? renderSuggestions(input.sections.suggestions) : ""}
${input.sections.on_the_horizon ? renderHorizon(input.sections.on_the_horizon) : ""}
${input.sections.fun_ending ? renderFunEnding(input.sections.fun_ending) : ""}
${renderArchive(a)}
</body></html>`
}

export * as InsightsRender from "./render"
