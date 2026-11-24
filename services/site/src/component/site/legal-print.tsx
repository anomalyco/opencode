import { createContext, createSignal, For, Match, onMount, Show, Switch, useContext } from "solid-js"
import { Dynamic } from "solid-js/web"
import { encode } from "uqr"
import { config } from "~/config"
import { legalDate, legalVersions, published, type LegalDocumentContent, type LegalNode } from "~/lib/legal"
import { modules, type Letter } from "~/lib/font-content"
import {
  architectCss,
  defaultMetrics,
  fieldSvg,
  formRow,
  label,
  logoImage,
  rulesSvg,
  running,
  type ArchitectLayout,
  type Divider,
  type RowMetrics,
  type TextKey,
  wholePixels,
} from "~/lib/legal/architect"
import type { legalPrintStyles } from "./settings"
import { coverPatternMarkup } from "~/lib/legal/cover-pattern"
import type { PatternParams } from "~/lib/legal/pattern"

/*
 * The designed print versions of a legal document (Settings › Legal print, or ?print=<style>).
 * Every style but "current" prints a cover sheet, then the document on a page system of its own:
 * running heads and page numbers in @page margin boxes, numbered sections in a meta column, links
 * as numbered references, and a colophon with the references and contacts at the end. The
 * elements here only print; the screen never shows them.
 */

export type LegalPrintStyle = (typeof legalPrintStyles)[number]

const wordmark = "/brand/files/opencode-wordmark-light.svg"
const logo = "/brand/files/opencode-logo-light.svg"
const entity = "Anomaly Innovations, Inc."
const address = ["2443 Fillmore St #380-6343", "San Francisco, CA 94115", "United States"]
const contact = "help@anoma.ly"

/** The numbered references for the links in the document text, by href. */
export const LegalReferences = createContext<Map<string, number>>()

/** The reference number a link prints with, or undefined (anchors, mail, outside a print style). */
export function useLegalReference(href: string | undefined) {
  const references = useContext(LegalReferences)
  return href ? references?.get(absolute(href)) : undefined
}

/** One key per address: site paths become full URLs, so a path and its full URL share a number. */
const absolute = (href: string) => (href.startsWith("/") ? `${config.baseUrl}${href}` : href)

/** Every link in the text that leaves the page, numbered in reading order, each address once. */
export function legalReferences(body: LegalNode[], route: (path: string) => string) {
  const hrefs = body.flatMap(function walk(node): string[] {
    if (typeof node === "string" || !published(node)) return []
    const [tag, attributes, ...children] = node
    const href = attributes.href
    const own = tag === "a" && href && !href.startsWith("#") && !href.startsWith("mailto:") ? [href] : []
    return [...own, ...children.flatMap(walk)]
  })
  const unique = [...new Set(hrefs.map((href) => absolute(href.startsWith("/") ? route(href) : href)))]
  return new Map(unique.map((href, index) => [href, index + 1]))
}

/** What a cover and the page heads say about a document. */
function facts(document: LegalDocumentContent, sections: { title: string }[]) {
  const latest = legalVersions(document.path)[0]
  const slug = document.path.split("/").pop() ?? ""
  const code = slug
    .split("-")
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase()
  const month = latest ? latest.date.slice(0, 7).replace("-", ".") : "DRAFT"
  return {
    title: document.title,
    words: document.title.split(" "),
    effective: document.effective.replace(/^Effective date:\s*/, ""),
    status: document.draft ? "Pending legal review" : "In effect",
    version: latest ? latest.sha.slice(0, 7) : "draft",
    changed: latest ? legalDate(latest.date) : "Not published",
    reference: `OC-LEG-${code}-${month}`,
    url: `${config.baseUrl}${document.path}`,
    host: `opencode.ai${document.path}`,
    sections: sections.map((section, index) => ({ number: index + 1, title: section.title })),
    description: document.description,
  }
}

export type Facts = ReturnType<typeof facts>

/** What the cover and the page heads say about a document (exported for the layout editor). */
export const legalPrintFacts = facts

/** The cover sheet, the colophon and the page rules for the chosen print style. */
export function LegalPrint(props: {
  style: LegalPrintStyle
  document: LegalDocumentContent
  sections: { id: string; title: string }[]
  references: Map<string, number>
  part: "cover" | "colophon"
  /** The architect style's layout (a concept, or the one saved in the layout editor). */
  layout?: ArchitectLayout
  /** The architect style's dividers inside the document. */
  divider?: Divider
  /** The case of the mono labels: sentence case, or capitals. */
  labelCase?: "sentence" | "upper"
  /** The architect cover's field pattern (lib/legal/cover-pattern.ts); none draws the layout's grid. */
  pattern?: Partial<PatternParams>
  /** Which pattern it is, for the pre-paint script: a Settings id, or "custom" from ?pattern=. */
  patternId?: string
}) {
  const info = () => facts(props.document, props.sections)
  // The running footer sits under its rule by the fonts' measurements, taken once they load.
  const metrics = useRowMetrics(() => running.valueSize, running.row)
  const rules = () =>
    props.style === "architect" && props.layout
      ? architectRules(props.layout, info(), props.divider ?? "solid", metrics())
      : pageRules(props.style, info())
  return (
    <Show when={props.style !== "current"}>
      <Show
        when={props.part === "cover"}
        fallback={
          <Colophon style={props.style} info={info()} references={props.references} labelCase={props.labelCase} />
        }
      >
        <style>{rules()}</style>
        <div
          lang="en"
          data-component="legal-print-cover"
          data-legal-print={props.style}
          data-architect-cover={props.style === "architect" ? "" : undefined}
          data-label-case={props.labelCase ?? "sentence"}
          data-pattern={props.patternId}
          aria-hidden="true"
        >
          <Switch>
            <Match when={props.style === "exhibit"}>
              <Exhibit info={info()} />
            </Match>
            <Match when={props.style === "architect"}>
              <Show when={props.layout}>
                {(layout) => <ArchitectCover info={info()} layout={layout()} pattern={props.pattern} />}
              </Show>
            </Match>
            <Match when={props.style === "letterhead"}>
              <Letterhead info={info()} />
            </Match>
            <Match when={props.style === "modular"}>
              <Modular info={info()} />
            </Match>
            <Match when={props.style === "swiss"}>
              <Swiss info={info()} />
            </Match>
          </Switch>
        </div>
      </Show>
    </Show>
  )
}

/** Corner display words, a centred justified column, a hairline cross and a dot matrix. */
function Exhibit(props: { info: Facts }) {
  const half = () => Math.ceil(props.info.words.length / 2)
  return (
    <>
      <div data-slot="rule-v" data-at="center" />
      <div data-slot="rule-v" data-at="left" />
      <div data-slot="rule-v" data-at="right" />
      <div data-slot="rule-h" data-at="upper" />
      <div data-slot="rule-h" data-at="lower" />
      <p data-slot="corner" data-at="left">
        {props.info.words.slice(0, half()).join(" ")}
      </p>
      <p data-slot="corner" data-at="right">
        {props.info.words.slice(half()).join(" ") || "."}
      </p>
      <DotMatrix columns={17} rows={11} />
      <div data-slot="column">
        <p data-slot="kicker">Exhibit {props.info.reference}</p>
        <p data-slot="text">{props.info.description}</p>
        <p data-slot="text">
          This copy was printed from {props.info.host}. The text in effect is the one published there; earlier versions
          and their changes are listed on the page.
        </p>
      </div>
      <p data-slot="labels">
        <span>(EFFECTIVE {props.info.effective.toUpperCase()})</span>
        <span>(VERSION {props.info.version.toUpperCase()})</span>
        <span>({props.info.sections.length} SECTIONS)</span>
        <span>(EN)</span>
      </p>
      <div data-slot="brand">
        <img src={wordmark} alt="OpenCode" />
        <span>{entity}</span>
      </div>
    </>
  )
}

/**
 * The architect cover: a square grid, one small logo top left, and the title
 * directly above the form block at the bottom left. Positions come from the layout (architect.ts).
 * `onText` makes the labels editable in place (the layout editor).
 */
export function ArchitectCover(props: {
  info: Facts
  layout: ArchitectLayout
  onText?: (key: TextKey, value: string) => void
  /** A field pattern in place of the layout's square grid, as inline vector SVG on the sheet. */
  pattern?: Partial<PatternParams>
}) {
  const text = (key: TextKey) => label(props.layout, key)
  const Editable = (field: { key: TextKey; as?: "dt" | "dd" | "p" | "span" }) => (
    <Dynamic
      component={field.as ?? "span"}
      contentEditable={props.onText ? "plaintext-only" : undefined}
      spellcheck={false}
      data-editable={props.onText ? "" : undefined}
      onBlur={(event: FocusEvent) => props.onText?.(field.key, (event.currentTarget as HTMLElement).textContent ?? "")}
    >
      {text(field.key)}
    </Dynamic>
  )
  const cover = () => props.layout.cover
  // The grid stays clear of the blocks; the logo keeps two strokes (half its width) of clear space.
  const cutouts = () => [
    {
      ...cover().logo,
      x: cover().logo.x - cover().logo.w / 2,
      y: cover().logo.y - cover().logo.w / 2,
      w: cover().logo.w * 2,
      h: cover().logo.h + cover().logo.w,
    },
    cover().title,
    cover().form,
  ]
  const field = () => cover().field
  // The form's rules are SVG (exact weight in print), set from where the text sits in each row: its
  // baseline on the whole CSS pixel Chromium paints it on (rows and the block's top are whole pixels).
  const measured = useRowMetrics(() => cover().form.size, formRow)
  const metrics = () => ({ ...measured(), baseline: wholePixels(measured().baseline) })
  const rows = 6
  return (
    <>
      <Show
        when={props.pattern}
        fallback={
          <svg
            data-architect-part="field"
            preserveAspectRatio="xMidYMin slice"
            viewBox={`${field().x} ${field().y} ${field().w} ${field().h}`}
            aria-hidden="true"
            innerHTML={fieldSvg(field(), cutouts())}
          />
        }
      >
        {(pattern) => (
          <For each={["a4", "letter"] as const}>
            {(sheet) => (
              <svg
                data-architect-part="pattern"
                data-sheet={sheet}
                viewBox="0 0 210 297"
                aria-hidden="true"
                innerHTML={coverPatternMarkup(pattern(), sheet)}
              />
            )}
          </For>
        )}
      </Show>
      {/* One small logo: 4:5, above the 16 × 20px minimum; the interior pages repeat it here. */}
      <img data-architect-part="logo" src={logoImage(cover().logo).source} alt="OpenCode" />
      <div data-architect-part="title">
        <Editable key="kicker" as="p" />
        <div data-slot="cover-title">{props.info.title}</div>
      </div>
      <dl data-architect-part="form">
        <div>
          <Editable key="project" as="dt" />
          <Editable key="projectValue" as="dd" />
        </div>
        <div>
          <Editable key="number" as="dt" />
          <dd>{props.info.reference}</dd>
        </div>
        <div>
          <Editable key="name" as="dt" />
          <dd>{props.info.title}</dd>
        </div>
        <div>
          <Editable key="date" as="dt" />
          <dd>{props.info.effective}</dd>
        </div>
        <div>
          <Editable key="versionLabel" as="dt" />
          <dd>{props.info.version}</dd>
        </div>
        <div>
          <Editable key="sections" as="dt" />
          <dd>{props.info.sections.length}</dd>
        </div>
        <svg
          data-slot="rules"
          viewBox={`0 0 ${cover().form.w} ${rows * formRow + formRow}`}
          aria-hidden="true"
          innerHTML={rulesSvg(rows, formRow, cover().form.w, metrics())}
        />
      </dl>
    </>
  )
}

/** The architect style's page rules, from its layout and the running footer's measurements. */
function architectRules(layout: ArchitectLayout, info: Facts, divider: Divider, metrics?: RowMetrics) {
  return architectCss(
    layout,
    {
      title: info.title,
      reference: `${info.reference} · ${info.version}`,
      page: `counter(page, decimal-leading-zero) " of " counter(pages)`,
      metrics: metrics ?? defaultMetrics(running.valueSize, running.row),
    },
    divider,
  )
}

/**
 * Where text sits in a line box of `row` mm: the Inter value's baseline and cap height, and how far
 * the OpenTUI Mono label (at --mono-optical × the size) must move down to share that baseline. Measured
 * with the fonts the page has loaded, so the rules land where the text really is.
 */
export function measureRow(size: number, row: number): RowMetrics {
  const context = document.createElement("canvas").getContext("2d")!
  const px = (pt: number) => (pt * 96) / 72
  const mm = (value: number) => (value * 25.4) / 96
  const box = (row * 96) / 25.4
  const baseline = (font: string) => {
    context.font = font
    const metrics = context.measureText("H")
    return {
      baseline:
        (box - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 + metrics.fontBoundingBoxAscent,
      cap: metrics.actualBoundingBoxAscent,
    }
  }
  const sans = baseline(`${px(size)}px Inter`)
  const mono = baseline(`${px(size * 1.05)}px "OpenTUI Mono", "OpenTUI Mono Menlo", monospace`)
  return { baseline: mm(sans.baseline), cap: mm(sans.cap), shift: mm(sans.baseline - mono.baseline) }
}

/** Row metrics for a ruled block: Inter's defaults at first, then measured once the fonts load. */
export function useRowMetrics(size: () => number, row: number) {
  const [ready, setReady] = createSignal(false)
  onMount(() => void document.fonts.ready.then(() => setReady(true)))
  return () => (ready() ? measureRow(size(), row) : defaultMetrics(size(), row))
}

/** Logo and name top left, the date top right, a meta column and a wide body, a ruled footer. */
function Letterhead(props: { info: Facts }) {
  return (
    <>
      <header data-slot="head">
        <img src={wordmark} alt="OpenCode" />
        <p>{props.info.effective}</p>
      </header>
      <div data-slot="grid">
        <dl data-slot="meta">
          <div>
            <dt>Document</dt>
            <dd>{props.info.title}</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{props.info.reference}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{props.info.status}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              {props.info.version}, {props.info.changed}
            </dd>
          </div>
          <div>
            <dt>Entity</dt>
            <dd>{entity}</dd>
          </div>
        </dl>
        <div data-slot="body">
          <div data-slot="cover-title">{props.info.title}</div>
          <p>{props.info.description}</p>
          <ol>
            <For each={props.info.sections}>{(section) => <li>{section.title}</li>}</For>
          </ol>
        </div>
      </div>
      <footer data-slot="foot">
        <p>
          {entity}
          <br />
          {address.join("\n")}
        </p>
        <p>
          {contact}
          <br />
          Questions about this document
        </p>
        <p>
          {props.info.host}
          <br />
          The current text
        </p>
      </footer>
    </>
  )
}

/** Small-caps contact blocks, the logo, a modular title, numbered contents and a QR to the page. */
function Modular(props: { info: Facts }) {
  return (
    <>
      <header data-slot="head">
        <img src={logo} alt="OpenCode" />
        <p>
          OpenCode
          <br />
          opencode.ai
        </p>
        <p>
          {entity}
          <br />
          San Francisco
        </p>
        <p>
          {contact}
          <br />
          Legal
        </p>
      </header>
      <ModuleWord word="opencode" />
      <div data-slot="cover-title">{props.info.title}</div>
      <div data-slot="grid">
        <dl data-slot="meta">
          <div>
            <dt>Document</dt>
            <dd>{props.info.reference}</dd>
          </div>
          <div>
            <dt>Effective</dt>
            <dd>{props.info.effective}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{props.info.version}</dd>
          </div>
          <div>
            <dt>Parties</dt>
            <dd>{entity} and you</dd>
          </div>
        </dl>
        <ol data-slot="contents">
          <For each={props.info.sections}>
            {(section) => (
              <li>
                <span>{section.number}.</span>
                {section.title}
              </li>
            )}
          </For>
        </ol>
      </div>
      <div data-slot="qr">
        <QrCode text={props.info.url} />
        <p>
          The current text
          <br />
          {props.info.host}
        </p>
      </div>
    </>
  )
}

/** A strict twelve-column grid, a flush-left title, big numerals and mono facts on the grid. */
function Swiss(props: { info: Facts }) {
  return (
    <>
      <For each={Array.from({ length: 13 })}>{(_, index) => <div data-slot="col" style={{ "--i": index() }} />}</For>
      <p data-slot="numeral">{String(props.info.sections.length).padStart(2, "0")}</p>
      <div data-slot="cover-title">
        <For each={props.info.words}>{(word) => <span>{word}</span>}</For>
      </div>
      <dl data-slot="facts">
        <div>
          <dt>Document</dt>
          <dd>{props.info.reference}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{props.info.effective}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{props.info.version}</dd>
        </div>
        <div>
          <dt>Sections</dt>
          <dd>{props.info.sections.length}</dd>
        </div>
      </dl>
      <div data-slot="brand">
        <img src={wordmark} alt="OpenCode" />
        <span>{entity}</span>
      </div>
    </>
  )
}

/** The last block: references for the numbered links, the document's facts and contacts. */
function Colophon(props: {
  style: LegalPrintStyle
  info: Facts
  references: Map<string, number>
  labelCase?: "sentence" | "upper"
}) {
  return (
    <section
      lang="en"
      data-component="legal-print-colophon"
      data-legal-print={props.style}
      data-label-case={props.labelCase ?? "sentence"}
      aria-hidden="true"
    >
      <Show when={props.references.size > 0}>
        <div data-slot="references">
          <h2>References</h2>
          <ol>
            <For each={[...props.references.keys()]}>{(href) => <li>{href}</li>}</For>
          </ol>
        </div>
      </Show>
      <div data-slot="colophon">
        <h2>Colophon</h2>
        <dl>
          <div>
            <dt>Document</dt>
            <dd>
              {props.info.title}, {props.info.reference}
            </dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              {props.info.version} · {props.info.changed} · {props.info.status}
            </dd>
          </div>
          <div>
            <dt>Current text</dt>
            <dd>{props.info.url}</dd>
          </div>
          <div>
            <dt>Entity</dt>
            <dd>
              {entity}, {address.join(", ")}
            </dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>{contact}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>Inter and OpenTUI Mono. Marks: the OpenCode logo, wordmark and font.</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

/** A field of dots as SVG circles (not a background), so it prints with background graphics off. */
function DotMatrix(props: { columns: number; rows: number }) {
  return (
    <svg
      data-slot="dots"
      viewBox={`0 0 ${props.columns * 10} ${props.rows * 10}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <For each={Array.from({ length: props.columns * props.rows })}>
        {(_, index) => (
          <circle cx={(index() % props.columns) * 10 + 5} cy={Math.floor(index() / props.columns) * 10 + 5} r="0.9" />
        )}
      </For>
    </svg>
  )
}

/** A word set in the OpenCode font's modules: each glyph is 4 × 7 squares, ink and shade. */
function ModuleWord(props: { word: string }) {
  const letters = () => [...props.word].filter((letter): letter is Letter => letter in modules)
  return (
    <svg data-slot="module-word" viewBox={`0 0 ${letters().length * 5 - 1} 7`} aria-hidden="true">
      <For each={letters()}>
        {(letter, index) => (
          <For each={modules[letter].flatMap((row, y) => [...row].map((cell, x) => ({ cell, x, y })))}>
            {(module) => (
              <Show when={module.cell !== "."}>
                <rect
                  x={index() * 5 + module.x}
                  y={module.y}
                  width="1"
                  height="1"
                  fill={module.cell === "#" ? "#1F1F1F" : "#D2D2D2"}
                />
              </Show>
            )}
          </For>
        )}
      </For>
    </svg>
  )
}

/** A QR code for the page's address, drawn as SVG squares. */
function QrCode(props: { text: string }) {
  const code = () => encode(props.text, { ecc: "M", border: 0 })
  return (
    <svg
      data-slot="qr-code"
      viewBox={`0 0 ${code().size} ${code().size}`}
      shape-rendering="crispEdges"
      aria-hidden="true"
    >
      <For each={code().data.flatMap((row, y) => row.map((on, x) => ({ on, x, y })).filter((cell) => cell.on))}>
        {(cell) => <rect x={cell.x} y={cell.y} width="1" height="1" fill="#000" />}
      </For>
    </svg>
  )
}

/**
 * The @page rules of a style: margins, and the running heads and page numbers in the margin boxes.
 * The cover is its own named page with no margins and no heads. Chromium has no running strings
 * (string-set), so the heads carry the document, not the current section.
 */
function pageRules(style: LegalPrintStyle, info: Facts) {
  const text = (value: string) => JSON.stringify(value)
  const mono = `font: 7pt "OpenTUI Mono", "OpenTUI Mono Menlo", ui-monospace, monospace; color: #000;`
  const sans = `font: 7pt "Inter", ui-sans-serif, system-ui, sans-serif; color: #000;`
  const page = `counter(page) " / " counter(pages)`
  const boxes: Record<Exclude<LegalPrintStyle, "current">, { margin: string; boxes: string }> = {
    exhibit: {
      margin: "24mm 26mm 22mm",
      boxes: `
        @top-left { content: ${text(info.title.toUpperCase())}; ${sans} letter-spacing: 0.12em; }
        @top-right { content: ${text(`(${info.reference})`)}; ${mono} }
        @bottom-center { content: ${page}; ${mono} }`,
    },
    // The architect style's running footer comes from its layout (architectRules); this is only the margin.
    architect: { margin: "32mm 15mm 21mm 15mm", boxes: "" },
    letterhead: {
      margin: "26mm 20mm 26mm",
      boxes: `
        @top-left { content: ${text(`OpenCode — ${info.title}`)}; ${sans} }
        @top-right { content: ${text(info.effective)}; ${sans} }
        @bottom-left { content: ${text(entity)}; ${sans} border-top: 0.5pt solid #000; vertical-align: top; padding-top: 2mm; }
        @bottom-center { content: ${text(info.host)}; ${sans} border-top: 0.5pt solid #000; vertical-align: top; padding-top: 2mm; }
        @bottom-right { content: ${page}; ${sans} border-top: 0.5pt solid #000; vertical-align: top; padding-top: 2mm; }`,
    },
    modular: {
      margin: "22mm 18mm 24mm",
      boxes: `
        @top-left { content: ${text(`OPENCODE / ${info.title.toUpperCase()}`)}; ${mono} letter-spacing: 0.06em; }
        @top-right { content: ${text(info.reference)}; ${mono} }
        @bottom-left { content: ${text(info.host)}; ${mono} }
        @bottom-right { content: ${page}; ${mono} }`,
    },
    swiss: {
      margin: "20mm 14mm 22mm",
      boxes: `
        @top-left { content: ${text(info.title)}; ${sans} font-weight: 700; }
        @top-right { content: ${page}; ${sans} font-weight: 700; }
        @bottom-left { content: ${text(`${info.reference} · ${info.version}`)}; ${mono} }
        @bottom-right { content: ${text(entity)}; ${sans} }`,
    },
  }
  if (style === "current") return ""
  const chosen = boxes[style]
  return `@media print {
  @page { margin: ${chosen.margin}; ${chosen.boxes} }
  @page legal-cover { margin: 0; @top-left { content: none } @top-center { content: none } @top-right { content: none } @bottom-left { content: none } @bottom-center { content: none } @bottom-right { content: none } }
}`
}
