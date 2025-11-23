import { FileDiff, Message, Part, Session, SessionStatus } from "@opencode-ai/sdk"
import { SessionTimeline } from "@opencode-ai/ui/session-timeline"
import { SessionReview } from "@opencode-ai/ui/session-review"
import { DataProvider, useData } from "@opencode-ai/ui/context"
import { createAsync, query, RouteDefinition, useParams } from "@solidjs/router"
import { createMemo, Show } from "solid-js"
import { Share } from "~/core/share"
import { Logo, Mark } from "@opencode-ai/ui/logo"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { iife } from "@opencode-ai/util/iife"
import { Binary } from "@opencode-ai/util/binary"
import { DateTime } from "luxon"

const getData = query(async (sessionID) => {
  const data = await Share.data(sessionID)
  const result: {
    session: Session[]
    session_diff: {
      [sessionID: string]: FileDiff[]
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
  } = {
    session: [],
    session_diff: {
      [sessionID]: [],
    },
    session_status: {
      [sessionID]: {
        type: "idle",
      },
    },
    message: {},
    part: {},
  }

  for (const item of data) {
    switch (item.type) {
      case "session":
        result.session.push(item.data)
        break
      case "session_diff":
        result.session_diff[sessionID] = item.data
        break
      case "session_status":
        result.session_status[sessionID] = item.data
        break
      case "message":
        result.message[item.data.sessionID] = result.message[item.data.sessionID] ?? []
        result.message[item.data.sessionID].push(item.data)
        break
      case "part":
        result.part[item.data.messageID] = result.part[item.data.messageID] ?? []
        result.part[item.data.messageID].push(item.data)
        break
    }
  }
  return result
}, "getShareData")

export const route = {
  preload: ({ params }) => getData(params.sessionID),
} satisfies RouteDefinition

export default function () {
  const params = useParams()
  const data = createAsync(async () => {
    if (!params.sessionID) return
    return getData(params.sessionID)
  })

  return (
    <Show when={data()}>
      {(data) => (
        <DataProvider data={data()}>
          {iife(() => {
            const data = useData()
            const match = createMemo(() => Binary.search(data.session, params.sessionID!, (s) => s.id))
            if (!match().found) throw new Error(`Session ${params.sessionID} not found`)
            const info = createMemo(() => data.session[match().index])
            const firstUserMessage = createMemo(() =>
              data.message[params.sessionID!]?.filter((m) => m.role === "user")?.at(0),
            )
            const provider = createMemo(() => firstUserMessage()?.model?.providerID)
            const model = createMemo(() => firstUserMessage()?.model?.modelID)
            const diffs = createMemo(() => data.session_diff[params.sessionID!] ?? [])

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
                  <div class="w-full flex-1 min-h-0 flex">
                    <div
                      classList={{
                        "@container relative shrink-0 pt-14 flex flex-col gap-10 min-h-0 w-full mx-auto": true,
                        "px-21 @4xl:px-6 max-w-2xl": diffs().length > 0,
                        "px-6 max-w-2xl": diffs().length === 0,
                      }}
                    >
                      <div class="flex flex-col gap-4 shrink-0">
                        <div class="h-8 flex gap-4 items-center justify-start self-stretch">
                          <div class="pl-[2.5px] pr-2 flex items-center gap-1.75 bg-surface-strong shadow-xs-border-base">
                            <Mark class="shrink-0 w-3 my-0.5" />
                            <div class="text-12-mono text-text-base">v{info().version}</div>
                          </div>
                          <div class="flex gap-2 items-center">
                            <img
                              src={`https://models.dev/logos/${provider()}.svg`}
                              class="size-4 shrink-0 dark:invert"
                            />
                            <div class="text-12-regular text-text-base">{model()}</div>
                          </div>
                          <div class="text-12-regular text-text-weaker">
                            {DateTime.fromMillis(info().time.created).toFormat("dd MMM yyyy, HH:mm")}
                          </div>
                        </div>
                        <div class="text-left text-16-medium text-text-strong">{info().title}</div>
                      </div>
                      <SessionTimeline
                        sessionID={params.sessionID!}
                        classes={{ root: "grow", content: "flex flex-col justify-between", container: "pb-20" }}
                        expanded
                      >
                        <div class="flex items-center justify-center pb-8 shrink-0">
                          <Logo class="w-58.5 opacity-12" />
                        </div>
                      </SessionTimeline>
                    </div>
                    <Show when={diffs().length}>
                      <div class="relative grow px-6 pt-14 flex-1 min-h-0 border-l border-border-weak-base">
                        <SessionReview diffs={diffs()} class="pb-20" />
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            )
          })}
        </DataProvider>
      )}
    </Show>
  )
}
