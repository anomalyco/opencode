import { usePlugin } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { showToast } from "@opencode/ui/toast"
import { createMemo, on, Show } from "solid-js"
import { actionGuard } from "./activation-delay"
import { displayHost, hostDisplay } from "./host-display"
import type definition from "./index"

export function RefusalBar(props: {
  notice: { token: string; text: string; target?: string; label?: string }
  answer: (dismiss: boolean) => Promise<void>
}) {
  const ctx = usePlugin<typeof definition>()

  const guard = createMemo(
    on(
      () => props.notice.token,
      () => actionGuard(performance.now()),
    ),
  )

  const press = (event: PointerEvent) => guard().press(event)

  const key = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") guard().press(event, event.repeat)
  }

  const answer = (dismiss: boolean) =>
    void props.answer(dismiss).catch(() => showToast({ title: ctx.t("common.requestFailed") }))

  return (
    <section class="flex shrink-0 items-center gap-3 border-b-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2">
      <div role="status" class="min-w-0 flex-1 text-13-regular text-v2-text-text-base">
        {props.notice.text}
        <Show when={props.notice.target}>
          {(target) => {
            // A web address names its host as every prompt does (`displayHost`), whole, before the rest is cut short.
            const web = () => hostDisplay(target())

            return (
              <bdi dir="ltr" class="flex min-w-0 text-12-regular text-v2-text-text-muted" title={target()}>
                <Show
                  when={web()}
                  fallback={
                    <>
                      <span class="min-w-0 truncate">{target().slice(0, -12)}</span>
                      <span class="shrink-0">{target().slice(-12)}</span>
                    </>
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
            variant="neutral"
            size="small"
            onPointerDown={press}
            onPointerCancel={() => guard().cancel()}
            onBlur={() => guard().cancel()}
            onKeyDown={key}
            onClick={(event: MouseEvent) => {
              if (guard().accept(event)) answer(false)
            }}
          >
            {label()}
          </Button>
        )}
      </Show>
      <IconButton
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
