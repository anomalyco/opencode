import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { UserMessage } from "@opencode-ai/sdk/v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
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
import { excludeSideChatHistory } from "@/pages/session/side-chat"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { SessionRouteKey, SessionStateKey } from "@/utils/server-scope"

export function SideChatPanel(props: {
  sessionID: string
  parentID: string
  initialMessageIDs: ReadonlySet<string>
  onClose: () => void
}) {
  const language = useLanguage()
  const settings = useSettings()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const sync = useSync()
  const prompt = createPromptState()
  const sessionID = () => props.sessionID
  const sessionKey = createMemo(() =>
    SessionStateKey.from(serverSDK().scope, SessionRouteKey.fromRoute(base64Encode(sdk().directory), props.sessionID)),
  )
  const inputController = createPromptInputController({
    sessionKey,
    sessionID,
    queryOptions: serverSync().queryOptions,
  })
  const userMessages = createMemo(() =>
    excludeSideChatHistory(sync().data.message[props.sessionID] ?? [], props.initialMessageIDs).filter(
      (message): message is UserMessage => message.role === "user",
    ),
  )
  const parentStatus = createMemo(() => sync().data.session_status[props.parentID]?.type ?? "idle")
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
    <aside
      id="side-chat-panel"
      aria-label={language.t("session.sideChat.title")}
      class="w-[min(420px,40vw)] min-w-80 h-full shrink-0 flex flex-col overflow-hidden"
      classList={{
        "rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]": newLayout(),
        "border-s border-border-weaker-base bg-background-base": !newLayout(),
      }}
    >
      <header
        class="px-3 shrink-0 flex items-center justify-between gap-3 border-b"
        classList={{
          "h-[52px] border-v2-border-border-muted bg-v2-background-bg-base": newLayout(),
          "h-10 border-border-weaker-base bg-background-stronger": !newLayout(),
        }}
      >
        <div class="min-w-0 flex items-center gap-2">
          <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
          <h2
            class="truncate text-[13px] font-[530] leading-4 tracking-[-0.04px]"
            classList={{
              "text-v2-text-text-base": newLayout(),
              "text-text-strong": !newLayout(),
            }}
          >
            {language.t("session.sideChat.title")}
          </h2>
          <Tag class="ml-0.5 max-w-36" aria-live="polite">
            <span
              class="size-1.5 shrink-0 rounded-full"
              classList={{
                "bg-v2-icon-icon-muted": parentStatus() === "idle",
                "bg-v2-icon-icon-accent animate-pulse": parentStatus() !== "idle",
              }}
            />
            {language.t(parentStatus() === "idle" ? "session.sideChat.parentIdle" : "session.sideChat.parentWorking")}
          </Tag>
        </div>
        <TooltipV2 value={language.t("common.close")} placement="bottom">
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            aria-label={language.t("session.sideChat.close")}
            icon={<Icon name="xmark-small" class="text-v2-icon-icon-muted" />}
            onClick={props.onClose}
          />
        </TooltipV2>
      </header>

      <div class="relative flex-1 min-h-0 overflow-hidden">
        <MessageTimeline
          sessionID={sessionID}
          sessionKey={sessionKey}
          excludeMessageIDs={props.initialMessageIDs}
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
          anchor={(id) => `side-chat-${id}`}
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
        <SideChatComposer state={prompt} controls={inputController()} newLayout={newLayout()} onSubmit={resumeScroll} />
      </div>
    </aside>
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
