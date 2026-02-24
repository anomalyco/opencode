import { createResource, For, Show, createEffect, on, onCleanup, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import { checksum } from "@opencode-ai/util/encode"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Code } from "@opencode-ai/ui/code"
import { useLanguage } from "@/context/language"

interface SessionRawContextTabProps {
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
}

export function SessionRawContextTab(props: SessionRawContextTabProps) {
  const params = useParams()
  const sdk = useSDK()
  const language = useLanguage()
  const [activeSubTab, setActiveSubTab] = createSignal("system")

  const [rawContext, { refetch }] = createResource(
    () => params.id,
    async (sessionID) => {
      if (!sessionID) return null
      const result = await sdk.client.session.context({ sessionID })
      return result.data
    },
  )

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = props.view()?.scroll("rawcontext")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      props.view().setScroll("rawcontext", next)
    })
  }

  createEffect(
    on(
      () => params.id,
      () => {
        refetch()
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <div
      class="@container h-full overflow-y-auto no-scrollbar pb-10"
      ref={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div class="px-6 pt-4 flex flex-col gap-4 h-full min-h-0">
        <Show when={rawContext.loading}>
          <div class="text-12-regular text-text-weak p-4 border border-border-base rounded-md bg-surface-base">
            {language.t("context.rawContext.loading")}
          </div>
        </Show>
        <Show when={rawContext.error}>
          <div class="text-12-regular text-syntax-error p-4 border border-border-base rounded-md bg-surface-base">
            {language.t("context.rawContext.error", { error: String(rawContext.error) })}
          </div>
        </Show>
        <Show when={rawContext()}>
          {(ctx) => (
            <div class="flex flex-col gap-4 h-full min-h-0">
              <div class="text-11-regular text-text-weak shrink-0">
                {language.t("context.rawContext.model")}: {ctx().model.providerID}/{ctx().model.modelID} |{" "}
                {language.t("context.rawContext.agent")}: {ctx().agent}
              </div>

              <Tabs value={activeSubTab()} onChange={setActiveSubTab} class="flex flex-col flex-1 min-h-0">
                <Tabs.List class="shrink-0">
                  <Tabs.Trigger value="system">
                    {language.t("context.rawContext.systemPrompts")} ({ctx().system.length})
                  </Tabs.Trigger>
                  <Tabs.Trigger value="messages">
                    {language.t("context.rawContext.llmMessages")} ({ctx().messages.length})
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="system" class="bg-background-base flex-1 min-h-0 overflow-auto">
                  <div class="p-3 flex flex-col gap-3">
                    <For each={ctx().system}>
                      {(prompt, i) => (
                        <div class="flex flex-col gap-1">
                          <div class="text-11-medium text-text-weak">
                            {language.t("context.rawContext.systemPromptN", { n: i() + 1 })}
                          </div>
                          <Code
                            file={{
                              name: `system-prompt-${i() + 1}.txt`,
                              contents: prompt,
                              cacheKey: checksum(prompt),
                            }}
                            overflow="wrap"
                            class="select-text"
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </Tabs.Content>
                <Tabs.Content value="messages" class="bg-background-base flex-1 min-h-0 overflow-auto">
                  <div class="p-3">
                    <Code
                      file={{
                        name: "llm-messages.json",
                        contents: JSON.stringify(ctx().messages, null, 2),
                        cacheKey: checksum(JSON.stringify(ctx().messages)),
                      }}
                      overflow="wrap"
                      class="select-text"
                    />
                  </div>
                </Tabs.Content>
              </Tabs>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
