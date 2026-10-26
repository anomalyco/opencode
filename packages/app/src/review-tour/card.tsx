import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Textarea } from "@opencode/ui/textarea"
import { createEffect, createSignal, For, on, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import type { TourStop, TourVerdict } from "./manifest"

export type TourStatus = { kind: "sending" | "sent" | "failed" | "problem"; text: string }

/** The tour's card: where the tour is, what to look at, and the stop's verdict or decision. */
export function TourCard(props: {
  stop: TourStop
  position: number
  count: number
  verdict?: TourVerdict
  /** The option a decision shows now. */
  selected?: number
  status?: TourStatus
  editing?: boolean
  /** A verdict is sending: its controls wait so it goes once. */
  busy?: boolean
  /** Verdicts go to a coordinator session, rather than staying in the tour. */
  coordinator?: boolean
  onEdit: (editing: boolean) => void
  onPrevious: () => void
  onNext: () => void
  onSelect: (index: number) => void
  onVerdict: (verdict: TourVerdict) => void
  onCollapse: () => void
  onClose: () => void
  /** Starts a drag from the card's header: its top row, title and description. */
  onGrab?: (event: PointerEvent) => void
}) {
  const language = useLanguage()
  const [note, setNote] = createSignal("")

  // What happened last, else the verdict this stop already has.
  const line = () =>
    props.status ?? (props.verdict && { kind: "recorded" as const, text: verdictLabel(props.verdict, language.t) })

  // The note stays until the stop changes, so a send that fails can be retried as written.
  createEffect(
    on(
      () => props.stop.id,
      () => setNote(""),
      { defer: true },
    ),
  )

  const send = () => {
    const text = note().trim()

    if (!text || props.busy) return
    props.onVerdict({ kind: "changes", note: text })
  }

  return (
    <div
      data-slot="review-tour-card"
      class="flex w-[288px] flex-col gap-2 rounded-xl bg-v2-background-bg-layer-01 p-3 pt-2 text-v2-text-text-base shadow-[var(--v2-elevation-floating)]"
    >
      <div
        data-slot="review-tour-header"
        class="flex cursor-grab touch-none flex-col gap-2 select-none active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) return
          props.onGrab?.(event)
        }}
      >
        <div class="-mr-1 flex h-6 items-center gap-2">
          <span
            data-slot="review-tour-id"
            class="rounded-[4px] bg-[color-mix(in_oklch,var(--v2-background-bg-accent)_16%,transparent)] px-1.5 font-mono text-[12px] leading-5 text-v2-text-text-accent [font-feature-settings:'zero']"
          >
            {props.stop.id}
          </span>
          <span class="text-[12px] leading-4 text-v2-text-text-faint tabular-nums">
            {language.t("tour.position", { current: String(props.position), total: String(props.count) })}
          </span>
          <span class="flex-1" />
          <IconButton
            size="small"
            variant="ghost"
            icon={<Icon name="outline-arrow-left" />}
            aria-label={language.t("tour.previous")}
            title={language.t("tour.previous")}
            disabled={props.position <= 1}
            onClick={props.onPrevious}
          />
          <IconButton
            size="small"
            variant="ghost"
            icon={<Icon name="outline-arrow-right" />}
            aria-label={language.t("tour.next")}
            title={language.t("tour.next")}
            disabled={props.position >= props.count}
            onClick={props.onNext}
          />
          <IconButton
            size="small"
            variant="ghost"
            icon={<Icon name="minus" />}
            aria-label={language.t("tour.collapse")}
            title={language.t("tour.collapse")}
            onClick={props.onCollapse}
          />
          <IconButton
            size="small"
            variant="ghost"
            icon={<Icon name="xmark-small" />}
            aria-label={language.t("tour.close")}
            title={language.t("tour.close")}
            onClick={props.onClose}
          />
        </div>

        <div class="flex flex-col gap-1">
          <div class="text-[13px] leading-4 font-medium [text-wrap:balance]">{props.stop.title}</div>
          <Show when={props.stop.look}>
            {(look) => <div class="text-[12px] leading-4 text-v2-text-text-muted [text-wrap:pretty]">{look()}</div>}
          </Show>
        </div>
      </div>

      <Show
        when={props.stop.options}
        fallback={
          <Show
            when={props.editing}
            fallback={
              <div class="flex gap-1.5">
                <Button
                  size="small"
                  variant="submit"
                  icon="check"
                  disabled={props.busy}
                  onClick={() => props.onVerdict({ kind: "ship" })}
                >
                  {language.t("tour.ship")}
                </Button>
                <Button
                  size="small"
                  variant="neutral"
                  disabled={props.busy}
                  title={language.t(props.coordinator ? "tour.changes.coordinator" : "tour.changes.kept")}
                  onClick={() => props.onEdit(true)}
                >
                  {language.t("tour.changes")}
                </Button>
                <Button
                  size="small"
                  variant="ghost-muted"
                  disabled={props.busy}
                  onClick={() => props.onVerdict({ kind: "skip" })}
                >
                  {language.t("tour.skip")}
                </Button>
              </div>
            }
          >
            <div class="flex flex-col gap-1.5">
              <Textarea
                rows={3}
                autofocus
                data-owns-escape
                placeholder={language.t("tour.note")}
                value={note()}
                onInput={(event) => setNote(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") return props.onEdit(false)

                  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
                  event.preventDefault()
                  send()
                }}
              />
              <div class="text-[12px] leading-4 text-v2-text-text-faint">
                {language.t(props.coordinator ? "tour.note.coordinator" : "tour.note.kept", { id: props.stop.id })}
              </div>
              <div class="flex gap-1.5">
                <Button size="small" variant="submit" disabled={!note().trim() || props.busy} onClick={send}>
                  {language.t("tour.send")}
                </Button>
                <Button size="small" variant="ghost-muted" onClick={() => props.onEdit(false)}>
                  {language.t("tour.cancel")}
                </Button>
              </div>
            </div>
          </Show>
        }
      >
        {(options) => (
          <div class="flex flex-col gap-1.5">
            <div role="radiogroup" class="-mx-1.5 flex flex-col">
              <For each={options()}>
                {(option, index) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={props.selected === index()}
                    class="flex min-h-7 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] leading-4 hover:bg-v2-overlay-simple-overlay-hover"
                    classList={{ "bg-v2-background-bg-layer-03": props.selected === index() }}
                    onClick={() => props.onSelect(index())}
                  >
                    <span
                      class="size-3 shrink-0 rounded-full border border-v2-border-border-strong"
                      classList={{ "border-[4px] border-v2-icon-icon-accent": props.selected === index() }}
                    />
                    <span class="flex-1">{option.label}</span>
                    <Show when={index() < 9}>
                      <span class="font-mono text-[11px] leading-4 text-v2-text-text-faint">⌥{index() + 1}</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <div class="flex gap-1.5">
              <Button
                size="small"
                variant="submit"
                disabled={props.selected === undefined || props.busy}
                onClick={() => {
                  const option = props.selected === undefined ? undefined : options()[props.selected]

                  if (option) props.onVerdict({ kind: "pick", option: option.label })
                }}
              >
                {language.t("tour.pick")}
              </Button>
              <Button
                size="small"
                variant="ghost-muted"
                disabled={props.busy}
                onClick={() => props.onVerdict({ kind: "skip" })}
              >
                {language.t("tour.skip")}
              </Button>
            </div>
          </div>
        )}
      </Show>

      <Show when={line()}>
        {(line) => (
          <div
            data-slot="review-tour-status"
            class="flex items-center gap-1.5 text-[12px] leading-4"
            classList={{
              "text-v2-text-text-faint": line().kind === "sending" || line().kind === "recorded",
              "text-v2-state-fg-success": line().kind === "sent",
              "text-v2-state-fg-danger": line().kind === "failed",
              "text-v2-state-fg-warning": line().kind === "problem",
            }}
          >
            <Show when={line().kind === "sent" || line().kind === "recorded"}>
              <Icon name="check" size="small" />
            </Show>
            <span class="min-w-0 flex-1 truncate">{line().text}</span>
          </div>
        )}
      </Show>
    </div>
  )
}

/** The collapsed tour: just where it is. */
export function TourPill(props: {
  stop: TourStop
  position: number
  count: number
  onGrab?: (event: PointerEvent) => void
}) {
  const language = useLanguage()

  return (
    <div
      data-slot="review-tour-pill"
      role="button"
      tabIndex={0}
      aria-label={language.t("tour.expand")}
      class="flex h-7 cursor-grab touch-none items-center gap-1.5 rounded-full bg-v2-background-bg-layer-01 px-2.5 text-[12px] leading-4 shadow-[var(--v2-elevation-floating)] select-none active:cursor-grabbing"
      onPointerDown={(event) => props.onGrab?.(event)}
    >
      <span class="size-1.5 rounded-full bg-v2-icon-icon-accent" />
      <span class="font-mono text-v2-text-text-accent [font-feature-settings:'zero']">{props.stop.id}</span>
      <span class="text-v2-text-text-faint tabular-nums">
        {language.t("tour.position", { current: String(props.position), total: String(props.count) })}
      </span>
    </div>
  )
}

export function verdictLabel(verdict: TourVerdict, t: ReturnType<typeof useLanguage>["t"]) {
  if (verdict.kind === "pick") return t("tour.verdict.pick", { option: verdict.option })

  return t(`tour.verdict.${verdict.kind}`)
}

/** The prompt the coordinator reads: `Tour verdict: R-158 ship`. */
export function verdictPrompt(id: string, verdict: TourVerdict) {
  if (verdict.kind === "changes") return `Tour verdict: ${id} changes: ${verdict.note}`

  if (verdict.kind === "pick") return `Tour verdict: ${id} pick ${verdict.option}`

  return `Tour verdict: ${id} ${verdict.kind}`
}
