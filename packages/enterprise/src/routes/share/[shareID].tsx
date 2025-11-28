import { FileDiff, Message, Model, Part, Session, SessionStatus, UserMessage } from "@opencode-ai/sdk"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { DataProvider } from "@opencode-ai/ui/context"
import { createAsync, query, useParams } from "@solidjs/router"
import { createEffect, createMemo, ErrorBoundary, For, Match, Show, Switch } from "solid-js"
import { Share } from "~/core/share"
import { Logo, Mark } from "@opencode-ai/ui/logo"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { createDefaultOptions } from "@opencode-ai/ui/pierre"
import { iife } from "@opencode-ai/util/iife"
import { Binary } from "@opencode-ai/util/binary"
import { NamedError } from "@opencode-ai/util/error"
import { DateTime } from "luxon"
import { MessageNav } from "@opencode-ai/ui/message-nav"
import { createStore } from "solid-js/store"
import z from "zod"
import NotFound from "../[...404]"
import { Tabs } from "@opencode-ai/ui/tabs"
import { preloadMultiFileDiff, PreloadMultiFileDiffResult } from "@pierre/precision-diffs/ssr"

const SessionDataMissingError = NamedError.create(
  "SessionDataMissingError",
  z.object({
    sessionID: z.string(),
    message: z.string().optional(),
  }),
)

const getData = query(async (shareID) => {
  "use server"
  const share = await Share.get(shareID)
  if (!share) throw new SessionDataMissingError({ sessionID: shareID })
  const data = await Share.data(shareID)
  const result: {
    sessionID: string
    session: Session[]
    session_diff: {
      [sessionID: string]: FileDiff[]
    }
    session_diff_preload: {
      [sessionID: string]: PreloadMultiFileDiffResult<any>[]
    }
    session_status: {
      [sessionID: string]: SessionStatus
    }
    message: {
      [sessionID: string]: Message[]
    }
    part: {
      [messageID: string]: Part[]
    }
    model: {
      [sessionID: string]: Model[]
    }
  } = {
    sessionID: share.sessionID,
    session: [],
    session_diff: {
      [share.sessionID]: [],
    },
    session_diff_preload: {
      [share.sessionID]: [],
    },
    session_status: {
      [share.sessionID]: {
        type: "idle",
      },
    },
    message: {},
    part: {},
    model: {},
  }
  for (const item of data) {
    switch (item.type) {
      case "session":
        result.session.push(item.data)
        break
      case "session_diff":
        result.session_diff[share.sessionID] = item.data
        result.session_diff_preload[share.sessionID] = await Promise.all(
          item.data.map(async (diff) =>
            preloadMultiFileDiff<any>({
              oldFile: { name: diff.file, contents: diff.before },
              newFile: { name: diff.file, contents: diff.after },
              options: createDefaultOptions("unified"),
              // annotations,
            }),
          ),
        )
        break
      case "message":
        result.message[item.data.sessionID] = result.message[item.data.sessionID] ?? []
        result.message[item.data.sessionID].push(item.data)
        break
      case "part":
        result.part[item.data.messageID] = result.part[item.data.messageID] ?? []
        result.part[item.data.messageID].push(item.data)
        break
      case "model":
        result.model[share.sessionID] = item.data
        break
    }
  }
  const match = Binary.search(result.session, share.sessionID, (s) => s.id)
  if (!match.found) throw new SessionDataMissingError({ sessionID: share.sessionID })
  return result
}, "getShareData")

export default function () {
  const params = useParams()
  const data = createAsync(async () => {
    if (!params.shareID) throw new Error("Missing shareID")
    return getData(params.shareID)
  })

  createEffect(() => {
    console.log(data())
  })

  return (
    <ErrorBoundary
      fallback={(e) => {
        return (
          <Show when={e.message === "SessionDataMissingError"}>
            <NotFound />
          </Show>
        )
      }}
    >
      <Show when={data()}>
        {(data) => {
          const match = createMemo(() => Binary.search(data().session, data().sessionID, (s) => s.id))
          if (!match().found) throw new Error(`Session ${data().sessionID} not found`)
          const info = createMemo(() => data().session[match().index])

          return (
            <DataProvider data={data()} directory={info().directory}>
              {iife(() => {
                const [store, setStore] = createStore({
                  messageId: undefined as string | undefined,
                })
                const messages = createMemo(() =>
                  data().sessionID
                    ? (data().message[data().sessionID]?.filter((m) => m.role === "user") ?? []).sort(
                        (a, b) => b.time.created - a.time.created,
                      )
                    : [],
                )
                const firstUserMessage = createMemo(() => messages().at(0))
                const activeMessage = createMemo(
                  () => messages().find((m) => m.id === store.messageId) ?? firstUserMessage(),
                )
                function setActiveMessage(message: UserMessage | undefined) {
                  if (message) {
                    setStore("messageId", message.id)
                  } else {
                    setStore("messageId", undefined)
                  }
                }
                const provider = createMemo(() => activeMessage()?.model?.providerID)
                const modelID = createMemo(() => activeMessage()?.model?.modelID)
                const model = createMemo(() => data().model[data().sessionID]?.find((m) => m.id === modelID()))
                const diffs = createMemo(() => {
                  const diffs = data().session_diff[data().sessionID] ?? []
                  const preloaded = data().session_diff_preload[data().sessionID] ?? []
                  return diffs.map((diff) => ({
                    ...diff,
                    preloaded: preloaded.find((d) => d.newFile.name === diff.file),
                  }))
                })

                const title = () => (
                  <div class="flex flex-col gap-4">
                    <div class="h-8 flex gap-4 items-center justify-start self-stretch">
                      <div class="pl-[2.5px] pr-2 flex items-center gap-1.75 bg-surface-strong shadow-xs-border-base">
                        <Mark class="shrink-0 w-3 my-0.5" />
                        <div class="text-12-mono text-text-base">v{info().version}</div>
                      </div>
                      <div class="flex gap-2 items-center">
                        <img src={`https://models.dev/logos/${provider()}.svg`} class="size-3.5 shrink-0 dark:invert" />
                        <div class="text-12-regular text-text-base">{model()?.name ?? modelID()}</div>
                      </div>
                      <div class="text-12-regular text-text-weaker">
                        {DateTime.fromMillis(info().time.created).toFormat("dd MMM yyyy, HH:mm")}
                      </div>
                    </div>
                    <div class="text-left text-16-medium text-text-strong">{info().title}</div>
                  </div>
                )

                const turns = () => (
                  <div class="relative mt-2 pt-6 pb-8 min-w-0 w-full h-full overflow-y-auto no-scrollbar">
                    <div class="px-4">{title()}</div>
                    <div class="flex flex-col gap-15 items-start justify-start mt-4">
                      <For each={messages()}>
                        {(message) => (
                          <SessionTurn
                            sessionID={data().sessionID}
                            messageID={message.id}
                            classes={{
                              root: "min-w-0 w-full relative",
                              content:
                                "flex flex-col justify-between !overflow-visible [&_[data-slot=session-turn-message-header]]:top-[-32px]",
                              container: "px-4",
                            }}
                          />
                        )}
                      </For>
                    </div>
                    <div class="px-4 flex items-center justify-center pt-20 pb-8 shrink-0">
                      <Logo class="w-58.5 opacity-12" />
                    </div>
                  </div>
                )

                const wide = createMemo(() => diffs().length === 0)

                return (
                  <div class="relative bg-background-stronger w-screen h-screen overflow-hidden flex flex-col">
                    <header class="h-12 px-6 py-2 flex items-center justify-between self-stretch bg-background-base border-b border-border-weak-base">
                      <div class="">
                        <a href="https://opencode.ai">
                          <Mark />
                        </a>
                      </div>
                      <div class="flex gap-3 items-center">
                        <IconButton
                          as={"a"}
                          href="https://github.com/sst/opencode"
                          target="_blank"
                          icon="github"
                          variant="ghost"
                        />
                        <IconButton
                          as={"a"}
                          href="https://opencode.ai/discord"
                          target="_blank"
                          icon="discord"
                          variant="ghost"
                        />
                      </div>
                    </header>
                    <div class="select-text flex flex-col flex-1 min-h-0">
                      <div classList={{ "hidden w-full flex-1 min-h-0": true, "md:flex": wide(), "lg:flex": !wide() }}>
                        <div
                          classList={{
                            "@container relative shrink-0 pt-14 flex flex-col gap-10 min-h-0 w-full": true,
                            "mx-auto max-w-146": !wide(),
                          }}
                        >
                          <div
                            classList={{
                              "w-full flex justify-start items-start min-w-0": true,
                              "max-w-146 mx-auto px-6": wide(),
                              "pr-6 pl-18": !wide(),
                            }}
                          >
                            {title()}
                          </div>
                          <div class="flex items-start justify-start h-full min-h-0">
                            <Show when={messages().length > 1}>
                              <>
                                <MessageNav
                                  class="@6xl:hidden mt-2.5 absolute left-6"
                                  messages={messages()}
                                  current={activeMessage()}
                                  onMessageSelect={setActiveMessage}
                                  size="compact"
                                />
                                <MessageNav
                                  classList={{
                                    "hidden @6xl:flex absolute": true,
                                    "mt-0.5 left-[calc(((100%_-_min(100%,_36.5rem))_/_2)-1.5rem)] -translate-x-full":
                                      wide(),
                                    "mt-2.5 left-6": !wide(),
                                  }}
                                  messages={messages()}
                                  current={activeMessage()}
                                  onMessageSelect={setActiveMessage}
                                  size={wide() ? "normal" : "compact"}
                                />
                              </>
                            </Show>
                            <SessionTurn
                              sessionID={data().sessionID}
                              messageID={store.messageId ?? firstUserMessage()!.id!}
                              classes={{
                                root: "grow",
                                content: "flex flex-col justify-between items-start",
                                container: "w-full pb-20 " + (wide() ? "max-w-146 mx-auto px-6" : "pr-6 pl-18"),
                              }}
                            >
                              <div classList={{ "w-full flex items-center justify-center pb-8 shrink-0": true }}>
                                <Logo class="w-58.5 opacity-12" />
                              </div>
                            </SessionTurn>
                          </div>
                        </div>
                        <Show when={diffs().length > 0}>
                          <div class="relative grow pt-14 flex-1 min-h-0 border-l border-border-weak-base">
                            <SessionReview
                              diffs={diffs()}
                              classes={{
                                root: "pb-20",
                                header: "px-6",
                                container: "px-6",
                              }}
                            />
                          </div>
                        </Show>
                      </div>
                      <Switch>
                        <Match when={diffs().length > 0}>
                          <Tabs classList={{ "md:hidden": wide(), "lg:hidden": !wide() }}>
                            <Tabs.List>
                              <Tabs.Trigger value="session" class="w-1/2" classes={{ button: "w-full" }}>
                                Session
                              </Tabs.Trigger>
                              <Tabs.Trigger value="review" class="w-1/2 !border-r-0" classes={{ button: "w-full" }}>
                                5 Files Changed
                              </Tabs.Trigger>
                            </Tabs.List>
                            <Tabs.Content value="session" class="!overflow-hidden">
                              {turns()}
                            </Tabs.Content>
                            <Tabs.Content
                              forceMount
                              value="review"
                              class="!overflow-hidden hidden data-[selected]:block"
                            >
                              <div class="relative h-full pt-8 overflow-y-auto no-scrollbar">
                                <SessionReview
                                  diffs={diffs()}
                                  classes={{
                                    root: "pb-20",
                                    header: "px-4",
                                    container: "px-4",
                                  }}
                                />
                              </div>
                            </Tabs.Content>
                          </Tabs>
                        </Match>
                        <Match when={true}>
                          <div classList={{ "!overflow-hidden": true, "md:hidden": wide(), "lg:hidden": !wide() }}>
                            {turns()}
                          </div>
                        </Match>
                      </Switch>
                    </div>
                  </div>
                )
              })}
            </DataProvider>
          )
        }}
      </Show>
    </ErrorBoundary>
  )
}
