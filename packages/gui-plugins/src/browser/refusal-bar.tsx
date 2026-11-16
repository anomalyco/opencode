import { usePlugin } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { showToast } from "@opencode/ui/toast"
import { createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { actionGuard } from "./activation-delay"
import { displayHost, hostDisplay } from "./host-display"
import type definition from "./index"

export function RefusalBar(props: {
  notice: { token: string; origin: string; text: string; target?: string; label?: string; opensApp?: boolean }
  answer: (dismiss: boolean, copy?: boolean) => Promise<void>
}) {
  const ctx = usePlugin<typeof definition>()
  const [fits, setFits] = createSignal(false)
  const copyInstead = () => !!props.notice.opensApp && !fits()
  let targetBox: HTMLElement | undefined
  let inView = false

  const fullyShown = () =>
    inView &&
    !!targetBox?.clientHeight &&
    targetBox.scrollHeight <= targetBox.clientHeight &&
    targetBox.scrollWidth <= targetBox.clientWidth

  const observeTarget = (text: HTMLSpanElement) => {
    const observer = new ResizeObserver(() => setFits(fullyShown()))

    const visibility = new IntersectionObserver(
      ([entry]) => {
        inView = entry?.intersectionRatio === 1
        setFits(fullyShown())
      },
      { threshold: 1 },
    )

    observer.observe(text)
    visibility.observe(text)
    onCleanup(() => {
      observer.disconnect()
      visibility.disconnect()
      inView = false
      setFits(false)
    })
  }

  const guard = createMemo(on([() => props.notice.token, copyInstead], () => actionGuard(performance.now())))

  const press = (event: PointerEvent) => guard().press(event)

  const key = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") guard().press(event, event.repeat)
  }

  const answer = (dismiss: boolean) =>
    void props.answer(dismiss, copyInstead()).catch(() => showToast({ title: ctx.t("common.requestFailed") }))

  return (
    <section class="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2">
      <div role="status" class="contents text-13-regular text-v2-text-text-base">
        <div class="col-start-1 row-start-1 break-all">
          <div>{props.notice.origin}</div>
          {props.notice.text}
        </div>
        <Show when={props.notice.target}>
          {(target) => {
            // A web address names its host as every prompt does (`displayHost`), whole, before the rest is cut short.
            const web = () => hostDisplay(target())

            return (
              <bdi
                ref={targetBox}
                data-scrollable
                dir="ltr"
                class="col-span-3 row-start-2 flex min-w-0 max-h-20 overflow-auto font-mono text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted"
                title={target()}
              >
                <Show
                  when={web()}
                  fallback={
                    <span
                      ref={observeTarget}
                      class="block w-full min-w-0 whitespace-pre-wrap break-all select-text"
                      style={{
                        "font-family": "var(--font-family-mono)",
                        "font-size": "12px",
                        "line-height": "var(--line-height-compact)",
                        "line-break": "anywhere",
                      }}
                    >
                      {target()}
                    </span>
                  }
                >
                  {(parts) => (
                    <>
                      <span class="shrink-0">{displayHost(target())}</span>
                      <span class="min-w-0 truncate">{parts().rest}</span>
                    </>
                  )}
                </Show>
              </bdi>
            )
          }}
        </Show>
      </div>
      <Show when={props.notice.label}>
        {(label) => (
          <Button
            class="col-start-2 row-start-1"
            variant="neutral"
            size="small"
            onPointerDown={press}
            onPointerCancel={() => guard().cancel()}
            onBlur={() => guard().cancel()}
            onKeyDown={key}
            onClick={(event: MouseEvent) => {
              if (props.notice.opensApp && fullyShown() !== fits()) return setFits(fullyShown())

              if (guard().accept(event)) answer(false)
            }}
          >
            {copyInstead() ? ctx.t("link.copy") : label()}
          </Button>
        )}
      </Show>
      <IconButton
        class="col-start-3 row-start-1"
        variant="ghost-muted"
        size="small"
        aria-label={ctx.t("refused.dismiss")}
        icon={<Icon name="close" />}
        onPointerDown={press}
        onPointerCancel={() => guard().cancel()}
        onBlur={() => guard().cancel()}
        onKeyDown={key}
        onClick={(event) => {
          if (guard().accept(event)) answer(true)
        }}
      />
    </section>
  )
}
