import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { PromptInput } from "@/components/prompt-input"
import { PromptInputV2Composer, usePromptInputV2Controller } from "@/components/prompt-input-v2"
import type { PromptInputControls, PromptInputState } from "@/components/prompt-input/contracts"
import { useLanguage } from "@/context/language"
import { createPromptState } from "@/context/prompt"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { createPromptInputController } from "@/pages/session/composer"
import { MessageTimeline } from "@/pages/session/timeline/message-timeline"
import { excludeSideChatHistory, type SideChatTab } from "@/pages/session/side-chat"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { SessionRouteKey, SessionStateKey } from "@/utils/server-scope"

export function SideChatPanel(props: { tab: SideChatTab; active: boolean; onQuoteMain: (text: string) => void }) {
  const language = useLanguage()
  const settings = useSettings()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const sync = useSync()
  const prompt = createPromptState({ prompt: props.tab.initialPrompt })
  const sessionID = () => props.tab.sessionID
  const initialMessageIDs = createMemo(() => new Set(props.tab.initialMessageIDs))
  const sessionKey = createMemo(() =>
    SessionStateKey.from(
      serverSDK().scope,
      SessionRouteKey.fromRoute(base64Encode(sdk().directory), props.tab.sessionID ?? props.tab.tabID),
    ),
  )
  const inputController = createPromptInputController({
    sessionKey,
    sessionID,
    queryOptions: serverSync().queryOptions,
  })
  const userMessages = createMemo(() => {
    const id = props.tab.sessionID
    if (!id) return []
    return excludeSideChatHistory(sync().data.message[id] ?? [], initialMessageIDs()).filter(
      (message): message is UserMessage => message.role === "user",
    )
  })
  const newLayout = settings.general.newLayoutDesigns
  const [scroll, setScroll] = createStore({
    overflow: false,
    bottom: true,
    jump: false,
  })
  let scroller: HTMLDivElement | undefined

  const updateScroll = (element: HTMLDivElement) => {
    const overflow = element.scrollHeight > element.clientHeight + 1
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 8
    setScroll({ overflow, bottom, jump: overflow && !bottom })
  }
  const resumeScroll = () => {
    if (!scroller) return
    scroller.scrollTo({ top: scroller.scrollHeight })
    setScroll({ overflow: scroller.scrollHeight > scroller.clientHeight + 1, bottom: true, jump: false })
  }

  return (
    <Show when={props.active}>
      <div
        id={`side-chat-panel-${props.tab.ordinal}`}
        data-side-chat-panel={props.tab.tabID}
        role="tabpanel"
        aria-label={language.t("session.sideChat.numberedTitle", { number: props.tab.ordinal })}
        class="size-full min-h-0 flex flex-col overflow-hidden"
      >
        <Show
          when={sessionID()}
          fallback={
            <div class="size-full flex items-center justify-center text-13-regular text-text-weak">
              {language.t("common.loading")}
            </div>
          }
        >
          <div class="relative flex-1 min-h-0 overflow-hidden">
            <MessageTimeline
              sessionID={sessionID}
              sessionKey={sessionKey}
              excludeMessageIDs={initialMessageIDs()}
              header={false}
              scroll={scroll}
              onResumeScroll={resumeScroll}
              setScrollRef={(element) => {
                scroller = element
              }}
              onScheduleScrollState={updateScroll}
              onAutoScrollHandleScroll={() => {
                if (scroller) updateScroll(scroller)
              }}
              onMarkScrollGesture={() => {}}
              hasScrollGesture={() => false}
              onUserScroll={() => {}}
              onHistoryScroll={() => {}}
              onAutoScrollInteraction={() => {}}
              shouldAnchorBottom={() => scroll.bottom}
              centered={false}
              setContentRef={() => {}}
              userMessages={userMessages()}
              anchor={(id) => `side-chat-${props.tab.ordinal}-${id}`}
              selectionAction={{
                label: language.t("session.sideChat.quoteInMain"),
                onSelect: props.onQuoteMain,
              }}
            />
            <Show when={userMessages().length === 0}>
              <div class="absolute inset-0 px-8 pb-20 pointer-events-none flex items-center justify-center text-center">
                <p
                  class="max-w-64 text-[13px] font-[440] leading-5 tracking-[-0.04px]"
                  classList={{
                    "text-v2-text-text-muted": newLayout(),
                    "text-text-weak": !newLayout(),
                  }}
                >
                  {language.t("session.sideChat.empty")}
                </p>
              </div>
            </Show>
          </div>

          <div class="shrink-0 px-3 pb-3">
            <SideChatComposer
              state={prompt}
              controls={inputController()}
              newLayout={newLayout()}
              onSubmit={resumeScroll}
            />
          </div>
        </Show>
      </div>
    </Show>
  )
}

function SideChatComposer(props: {
  state: PromptInputState
  controls: PromptInputControls
  newLayout: boolean
  onSubmit: () => void
}) {
  return (
    <Show
      when={props.newLayout}
      fallback={<PromptInput class="w-full" state={props.state} controls={props.controls} onSubmit={props.onSubmit} />}
    >
      <SideChatComposerV2 state={props.state} controls={props.controls} onSubmit={props.onSubmit} />
    </Show>
  )
}

function SideChatComposerV2(props: { state: PromptInputState; controls: PromptInputControls; onSubmit: () => void }) {
  const controller = usePromptInputV2Controller({
    state: props.state,
    controls: props.controls,
    onSubmit: props.onSubmit,
  })
  return <PromptInputV2Composer controller={controller} borderUnderlay />
}
