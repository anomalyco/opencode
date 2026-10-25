import { Index, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import "./prompt-rail.css"

export type PromptRailEntry = {
  id: string
  /** Row index in the timeline projection, used to scroll the virtualizer. */
  index: number
}

export function PromptRail(props: {
  prompts: Accessor<readonly PromptRailEntry[]>
  current: Accessor<string | undefined>
  onJump: (prompt: PromptRailEntry) => void
  /** The rail is a sibling of the scroll viewport, so it must forward wheel input back to it. */
  onWheel: (event: WheelEvent) => void
}) {
  const language = useLanguage()
  // Keep every prompt inside a compact band centered on the timeline, so long sessions never
  // stretch the rail past the conversation they navigate.
  const slot = () => Math.min(10, 240 / Math.max(1, props.prompts().length))
  const bar = () => Math.min(2, Math.max(1, slot() * 0.5))

  return (
    <Show when={props.prompts().length > 1}>
      <nav
        data-slot="session-prompt-rail"
        aria-label={language.t("session.timeline.promptNavigation")}
        class="pointer-events-none absolute inset-y-0 end-3 z-40 items-center"
        onWheel={props.onWheel}
      >
        <div class="pointer-events-auto flex flex-col items-end">
          <Index each={props.prompts()}>
            {(prompt, index) => {
              const active = () => props.current() === prompt().id

              return (
                <button
                  type="button"
                  class="group flex w-7 cursor-pointer items-center justify-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-strong focus-visible:outline-offset-2"
                  style={{ height: `${slot()}px` }}
                  aria-label={language.t("session.timeline.jumpToPrompt", { index: index + 1 })}
                  aria-current={active() ? "location" : undefined}
                  onClick={() => props.onJump(prompt())}
                >
                  <span
                    class="block rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none"
                    classList={{
                      "bg-v2-text-text-base": active(),
                      "bg-v2-text-text-faint group-hover:bg-v2-text-text-muted group-focus-visible:bg-v2-text-text-base":
                        !active(),
                    }}
                    style={{
                      height: `${bar()}px`,
                      width: active() ? "24px" : "16px",
                    }}
                  />
                </button>
              )
            }}
          </Index>
        </div>
      </nav>
    </Show>
  )
}
