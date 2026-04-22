import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { MemoryPanel } from "@opencode-ai/ui-team/memory-panel"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { sdkJson } from "@/utils/sdk-team"
import { align, hasActiveTranslations, issue, type TranslateError } from "@/utils/translation"
import { createStore } from "solid-js/store"

export function SessionMemoryTab(props: { class?: string } = {}) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const { view } = useSessionLayout()
  const [state, setState] = createStore({
    translating: false,
    error: undefined as TranslateError | undefined,
  })

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let next: { x: number; y: number } | undefined

  const restore = () => {
    const el = scroll
    if (!el) return
    const pos = view().scroll("memory")
    if (!pos) return
    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const onScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    next = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      const pos = next
      next = undefined
      if (!pos) return
      view().setScroll("memory", pos)
    })
  }

  const stamp = createMemo(() => [sync.data.memory_entry.length, sync.data.memory_activity[0]?.id] as const)
  const translating = createMemo(() => state.translating || hasActiveTranslations(sync.data.memory_entry))

  createEffect(
    on(
      stamp,
      () => {
        requestAnimationFrame(restore)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  const translate = async () => {
    if (translating()) return
    if (sync.data.memory_entry.length === 0) return
    setState("translating", true)
    setState("error", undefined)
    await Promise.resolve()
      .then(async () => {
        await align({
          sdk: sdk.client,
          directory: sdk.directory,
          locale: language.locale(),
        })
      })
      .then(() =>
        sdkJson<{ count: number }>(sdk.client, {
          path: "/project/current/memory/translate",
          directory: sdk.directory,
          method: "POST",
        }),
      )
      .then(() => {
        showToast({
          title: language.t("ui.memory.toast.translateTitle"),
          description: language.t("ui.memory.panel.translating"),
        })
      })
      .catch((err: unknown) => {
        const next = issue({ err, t: language.t, tag: "memory", locale: language.locale() })
        setState("error", next)
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: next.message,
        })
      })
      .finally(() => {
        setState("translating", false)
      })
  }

  const remove = async (id: string) => {
    await sdkJson(sdk.client, {
      path: `/project/current/memory/${encodeURIComponent(id)}`,
      directory: sdk.directory,
      method: "DELETE",
    }).catch((err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: String(err instanceof Error ? err.message : err),
      })
    })
  }

  return (
    <ScrollView
      class={`h-full ${props.class ?? ""}`.trim()}
      viewportRef={(el) => {
        scroll = el
        restore()
      }}
      onScroll={onScroll}
    >
      <div class="px-6 pt-4 pb-10">
        <MemoryPanel
          entries={sync.data.memory_entry}
          activity={sync.data.memory_activity}
          translating={translating()}
          onTranslate={translate}
          onRemove={remove}
          translateError={state.error}
          onClearTranslateError={() => setState("error", undefined)}
        />
      </div>
    </ScrollView>
  )
}
