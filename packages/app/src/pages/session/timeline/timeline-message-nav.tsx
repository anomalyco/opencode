import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { DateTime } from "luxon"
import type { TextPart, UserMessage } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { layoutTimelineNavBeads, pickTimelineNavMessage } from "./message-nav"

export function MessageTimelineNav(props: {
  messages: UserMessage[]
  overflow: boolean
  listRoot: () => HTMLDivElement | undefined
  onJump: (message: UserMessage) => void
}) {
  const language = useLanguage()
  const sync = useSync()
  const [navEl, setNavEl] = createSignal<HTMLElement>()
  const [navHeight, setNavHeight] = createSignal<number>()
  const [activeID, setActiveID] = createSignal<string>()
  const [jumpTarget, setJumpTarget] = createSignal<string>()

  const layout = createMemo(() => layoutTimelineNavBeads({ count: props.messages.length, height: navHeight() ?? 0 }))

  createResizeObserver(navEl, ({ height }) => setNavHeight(height))

  let activeFrame: number | undefined
  const updateActive = () => {
    const root = props.listRoot()
    if (!root) return
    const box = root.getBoundingClientRect()
    const sticky = root.querySelector<HTMLElement>("[data-session-title]")?.getBoundingClientRect().height ?? 0
    const line = box.top + sticky + 24
    const items = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((element) => {
        const id = element.dataset.messageId ?? ""
        const rect = element.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item) => item.id)
    setActiveID(pickTimelineNavMessage({ line, viewportTop: box.top, viewportBottom: box.bottom, items }))
  }
  const scheduleActiveUpdate = () => {
    if (activeFrame !== undefined) return
    activeFrame = requestAnimationFrame(() => {
      activeFrame = undefined
      updateActive()
    })
  }

  createEffect(() => {
    const root = props.listRoot()
    if (!root) return
    root.addEventListener("scroll", scheduleActiveUpdate, { passive: true })
    onCleanup(() => root.removeEventListener("scroll", scheduleActiveUpdate))
    scheduleActiveUpdate()
  })

  createEffect(() => {
    const root = props.listRoot()
    if (!root) return
    const clearJumpTarget = () => setJumpTarget(undefined)
    root.addEventListener("wheel", clearJumpTarget, { passive: true })
    root.addEventListener("touchmove", clearJumpTarget, { passive: true })
    root.addEventListener("keydown", clearJumpTarget)
    onCleanup(() => {
      root.removeEventListener("wheel", clearJumpTarget)
      root.removeEventListener("touchmove", clearJumpTarget)
      root.removeEventListener("keydown", clearJumpTarget)
    })
  })

  createEffect(() => {
    props.messages
    scheduleActiveUpdate()
  })

  createEffect(() => {
    window.addEventListener("resize", scheduleActiveUpdate)
    onCleanup(() => window.removeEventListener("resize", scheduleActiveUpdate))
  })

  const resolvedActiveID = () => jumpTarget() ?? activeID()

  createEffect(() => {
    const id = resolvedActiveID()
    const nav = navEl()
    if (!id || !nav || nav.scrollHeight <= nav.clientHeight) return
    const bead = nav.querySelector<HTMLElement>(`[data-bead-id="${CSS.escape(id)}"]`)
    if (!bead) return
    nav.scrollTop = bead.offsetTop - (nav.clientHeight - bead.clientHeight) / 2
  })

  onCleanup(() => {
    if (activeFrame !== undefined) cancelAnimationFrame(activeFrame)
  })

  return (
    <Show when={props.messages.length >= 2 && props.overflow}>
      <nav
        ref={setNavEl}
        data-slot="timeline-message-nav"
        aria-label={language.t("session.messages.timelineNavigation")}
        class="pointer-events-none absolute top-1/2 z-40 hidden max-h-[70%] -translate-y-1/2 flex-col items-center overflow-y-auto end-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden @xl:flex"
        style={{ gap: `${layout().gap}px` }}
      >
        <For each={props.messages}>
          {(message, index) => {
            const active = () => props.messages.length > 0 && resolvedActiveID() === message.id
            const preview = createMemo(() => {
              const part = (sync().data.part[message.id] ?? []).find(
                (item): item is TextPart => item.type === "text" && !item.synthetic && !item.ignored,
              )
              if (!part) return ""
              return part.text.replace(/\n/g, " ").slice(0, 200)
            })
            const time = createMemo(() =>
              DateTime.fromMillis(message.time.created).setLocale(language.intl()).toLocaleString(DateTime.DATETIME_MED),
            )

            return (
              <button
                type="button"
                data-slot="timeline-message-bead"
                data-bead-id={message.id}
                data-active={active() ? "true" : undefined}
                class="pointer-events-auto shrink-0 cursor-pointer rounded-full border-none bg-border-base p-0 transition-all duration-150 hover:bg-border-strong-base data-[active]:bg-text-strong"
                style={{
                  width: `${layout().size}px`,
                  height: `${active() ? Math.min(layout().size * 2.5, 20) : layout().size}px`,
                }}
                title={preview() ? `${preview()}\n${time()}` : time()}
                aria-label={preview() || language.t("session.messages.jumpToMessage", { index: index() + 1 })}
                onClick={() => {
                  setJumpTarget(message.id)
                  props.onJump(message)
                }}
              />
            )
          }}
        </For>
      </nav>
    </Show>
  )
}
