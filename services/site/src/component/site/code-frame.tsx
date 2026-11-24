import { useI18n } from "~/context/i18n"
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { FileTypeIcon } from "./file-type-icon"
import type { DocsVariantKey } from "./settings"

/**
 * The frame around a docs code block: a header row with a label (a file name, a terminal mark,
 * "Files", "Usage") and a copy button that's always visible. It only shows with a component's
 * "Vercel square" option (docs-variants.css); the other options keep their own look, so the frame
 * folds away (display: contents) and its header hides.
 */
export function CodeFrame(props: {
  variant: DocsVariantKey
  kind: "file" | "terminal" | "code" | "tree" | "usage" | "response" | "config"
  label?: string
  /** The file whose icon leads a file's label, when the label says more than its path ("theme.json (excerpt)"). */
  file?: string
  /** The text to copy; leading "$ " prompts are dropped. No copy button without it. */
  copy?: string
  /** A different terminal mark, for the icon options in the code gallery. */
  icon?: "window" | "prompt" | "titlebar"
  /** The block's language, which the funnel reports with a copy (data-funnel-method). */
  method?: string
  children: JSX.Element
}) {
  return (
    <div data-component="code-frame" data-variant={props.variant} data-kind={props.kind} data-icon={props.icon}>
      <div data-slot="code-head">
        <span data-slot="code-label">
          <Show when={props.kind === "file" && (props.file ?? props.label)}>
            {(path) => <FileTypeIcon path={path()} />}
          </Show>
          {props.label}
        </span>
        <Show when={props.copy}>{(text) => <CopyButton text={text()} method={props.method} />}</Show>
      </div>
      {props.children}
    </div>
  )
}

/**
 * Copy with visible feedback, text only: "Copy" turns to "Copied" for 1.5s (or "Failed" when the
 * clipboard refuses), and a polite live region says what happened. The three labels share one
 * right-aligned grid cell, so the button keeps the longest label's width and the text's right edge
 * never moves. Pages that never hydrate (the docs) copy `data-code` from a delegated listener and
 * set `data-state` themselves (src/docs/client.ts).
 */
export function CopyButton(props: { text: string; slot?: "code-copy" | "copy"; method?: string }) {
  const i18n = useI18n()
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle")
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const show = (next: "copied" | "failed") => {
    setState(next)
    clearTimeout(timer)
    timer = setTimeout(() => setState("idle"), 1500)
  }
  const text = () => props.text.replace(/^\$ /gm, "")
  const copy = () => {
    const write = navigator.clipboard?.writeText(text())
    if (!write) return show("failed")
    write.then(
      () => show("copied"),
      () => show("failed"),
    )
  }
  return (
    <>
      <button
        type="button"
        data-slot={props.slot ?? "code-copy"}
        data-state={state()}
        data-funnel-copy="snippet"
        data-funnel-method={props.method}
        data-code={text()}
        aria-label={i18n.t("site.code.copy")}
        onClick={copy}
      >
        <span data-slot="copy-labels" aria-hidden="true">
          <span data-label="idle">{i18n.t("site.action.copy")}</span>
          <span data-label="copied">{i18n.t("site.action.copied")}</span>
          <span data-label="failed">{i18n.t("site.code.failed")}</span>
        </span>
      </button>
      <span data-slot="sr-only" aria-live="polite">
        {state() === "copied" ? i18n.t("site.code.copied") : state() === "failed" ? i18n.t("site.code.failedHint") : ""}
      </span>
    </>
  )
}

/**
 * Lines with the rest folded away. The folded lines stay in the page (hidden="until-found"), so
 * find in page reaches them and opens the block; Copy always copies everything.
 * "marker" (the default, chosen 5 Nov 2026) is a plain "⋯ 8 more lines" row in the gutter where the
 * lines are, GitHub style, that turns to "Show fewer lines" at the end of the revealed range.
 * "fade" and "bar" are the older options, kept for comparison in the gallery.
 */
export function CodeCollapse(props: {
  style?: "marker" | "fade" | "bar"
  visible: JSX.Element
  hidden: JSX.Element
  count: number
}) {
  const [open, setOpen] = createSignal(false)
  let folded: HTMLDivElement | undefined
  createEffect(() => {
    if (!folded) return
    if (open()) folded.removeAttribute("hidden")
    else folded.setAttribute("hidden", "until-found")
  })
  const style = () => props.style ?? "marker"
  const name = () => (open() ? `Show fewer lines, hide ${props.count}` : `Show ${props.count} more lines`)
  return (
    <div data-slot="code-collapse" data-style={style()} data-open={open() ? "" : undefined}>
      <div data-slot="collapse-visible">{props.visible}</div>
      <div
        data-slot="collapse-folded"
        ref={(el) => {
          folded = el
          el.setAttribute("hidden", "until-found")
          el.addEventListener("beforematch", () => setOpen(true))
        }}
      >
        {props.hidden}
      </div>
      <button
        type="button"
        data-slot="code-expand"
        aria-expanded={open()}
        aria-label={name()}
        onClick={() => setOpen(!open())}
      >
        <Show when={style() === "marker"} fallback={open() ? "Show fewer lines" : `Show ${props.count} more lines`}>
          <span data-slot="expand-mark" aria-hidden="true">
            ⋯
          </span>
          {open() ? "Show fewer lines" : `${props.count} more lines`}
        </Show>
      </button>
    </div>
  )
}

/** Numbered lines for the gallery (marks, focus dimming, a start number, no gutter when plain). */
export function CodeLines(props: {
  lines: string[]
  mark?: number[]
  focus?: number[]
  plain?: boolean
  start?: number
}) {
  return (
    <pre data-component="code-lines" data-plain={props.plain ? "" : undefined}>
      <For each={props.lines}>
        {(line, index) => {
          const n = (props.start ?? 1) + index()
          return (
            <code
              data-line={n}
              data-mark={props.mark?.includes(n) ? "" : undefined}
              data-dim={props.focus && !props.focus.includes(n) ? "" : undefined}
            >
              {line || " "}
              {"\n"}
            </code>
          )
        }}
      </For>
    </pre>
  )
}
