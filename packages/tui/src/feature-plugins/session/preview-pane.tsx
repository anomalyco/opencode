import { createResource, Show, createMemo, createSignal, onMount, type Accessor, type JSX } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { debounce, leadingAndTrailing } from "@solid-primitives/scheduled"
import type { Message, Part, Session as SdkSession } from "@opencode-ai/sdk/v2"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { Locale } from "../../util/locale"
import { Spinner } from "../../component/spinner"
import { extractMessageMarkdown, extractMessageText, relativeTime } from "./util"

type WithParts = { info: Message; parts: Part[] }

type Sdk = ReturnType<typeof useSDK>
type Sync = ReturnType<typeof useSync>

const messageCache = new Map<string, Promise<WithParts[]>>()

function cacheKey(sessionID: string, version: number) {
  return `${sessionID}:${version}`
}

function hydrateFromSync(sync: Sync, sessionID: string): WithParts[] | undefined {
  const infos = sync.data.message[sessionID]
  if (!infos || infos.length === 0) return undefined
  return infos.map((info) => ({ info, parts: sync.data.part[info.id] ?? [] }))
}

function loadMessages(sdk: Sdk, sessionID: string, version: number): Promise<WithParts[]> {
  const key = cacheKey(sessionID, version)
  const cached = messageCache.get(key)
  if (cached) return cached

  const promise = sdk.client.session
    .messages({ sessionID, limit: 50 })
    .then((res) => {
      if (res.error) throw res.error
      return (res.data as WithParts[] | undefined) ?? []
    })
    .catch((error) => {
      messageCache.delete(key)
      throw error
    })
  messageCache.set(key, promise)
  return promise
}

export function prefetchPreviews(sdk: Sdk, sync: Sync, sessionIDs: readonly string[]) {
  for (const id of sessionIDs) {
    const version = sync.data.session.find((session) => session.id === id)?.time.updated ?? 0
    if (!hydrateFromSync(sync, id)) loadMessages(sdk, id, version).catch(() => {})
  }
}

export function createLeadingTrailingSignal<T>(initial: T, ms: number): [Accessor<T>, (v: T) => void, (v: T) => void] {
  const [get, set] = createSignal(initial)
  const setNow = (v: T) => set(() => v)
  const schedule = leadingAndTrailing(debounce, setNow, ms)
  return [get, setNow, schedule]
}

export function SessionPreviewPane(props: {
  sessionID: Accessor<string | undefined>
  session?: Accessor<SdkSession | undefined>
}) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dimensions = useTerminalDimensions()

  const maxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height / 2) - 4))
  const session = createMemo(() => {
    const provided = props.session?.()
    if (provided) return provided
    const id = props.sessionID()
    if (!id) return undefined
    return sync.data.session.find((s) => s.id === id)
  })

  const status = createMemo(() => {
    const id = props.sessionID()
    if (!id) return undefined
    return sync.data.session_status?.[id]?.type
  })

  onMount(() => {
    const top = sync.data.session
      .filter((s) => s.parentID === undefined)
      .slice()
      .sort((a, b) => b.time.updated - a.time.updated)
      .slice(0, 5)
      .map((s) => s.id)
    prefetchPreviews(sdk, sync, top)
  })

  const syncedMessages = createMemo(() => {
    const id = props.sessionID()
    if (!id) return undefined
    return hydrateFromSync(sync, id)
  })

  const [fetchedMessages] = createResource(
    () => {
      const id = props.sessionID()
      if (!id || syncedMessages()) return undefined
      return { sessionID: id, version: session()?.time.updated ?? 0 }
    },
    async (input) => loadMessages(sdk, input.sessionID, input.version),
  )

  const messages = createMemo(() => syncedMessages() ?? fetchedMessages() ?? [])

  const exchange = createMemo(() => {
    const items = messages()
    if (!items || items.length === 0) return undefined
    const sorted = items.toSorted((a, b) => messageCreated(a) - messageCreated(b))
    const user = sorted.findLast((item) => messageRole(item) === "user")
    const assistant = user
      ? sorted.findLast((item) => messageRole(item) === "assistant" && messageParentID(item) === user.info.id)
      : sorted.findLast((item) => messageRole(item) === "assistant")
    return { user, assistant }
  })

  const loading = createMemo(() => fetchedMessages.loading && !exchange())

  const statusLabel = createMemo(() => {
    const s = status()
    if (s === "busy") return "working"
    if (s === "retry") return "retrying"
    return "idle"
  })

  return (
    <box
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
      height={maxHeight()}
      overflow="hidden"
    >
      <Show
        when={session()}
        fallback={
          <text fg={theme.textMuted} wrapMode="word">
            No session selected
          </text>
        }
      >
        {(s) => (
          <>
            <Header session={s()} statusLabel={statusLabel()} />
            <Show when={loading()}>
              <Spinner>loading preview...</Spinner>
            </Show>
            <Show
              when={exchange()}
              fallback={
                <Show when={!loading()}>
                  <text fg={theme.textMuted} wrapMode="word">
                    {fetchedMessages.error ? "Preview unavailable" : "No messages yet"}
                  </text>
                </Show>
              }
            >
              {(ex) => <Exchange exchange={ex()} />}
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}

function messageRole(item: WithParts) {
  return (item.info as { role?: string }).role
}

function messageCreated(item: WithParts) {
  return (item.info.time as { created?: number }).created ?? 0
}

function messageParentID(item: WithParts) {
  return (item.info as { parentID?: string }).parentID
}

const ROW_WIDTH = 40

function Header(props: { session: SdkSession; statusLabel: string }) {
  const { theme } = useTheme()
  const title = createMemo(() => Locale.truncate(props.session.title, ROW_WIDTH))
  const statusRest = createMemo(() => {
    const joined = ` · ${relativeTime(props.session.time.updated)}`
    return Locale.truncate(joined, Math.max(0, ROW_WIDTH - props.statusLabel.length))
  })

  return (
    <box flexDirection="column" gap={0} flexShrink={0}>
      <Row height={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none" overflow="hidden">
          {title()}
        </text>
      </Row>
      <Row height={1}>
        <text fg={theme.textMuted} wrapMode="none" overflow="hidden">
          <span>{props.statusLabel}</span>
          <span>{statusRest()}</span>
        </text>
      </Row>
    </box>
  )
}

function Row(props: { height: number; children: JSX.Element }) {
  return (
    <box height={props.height} flexShrink={0} overflow="hidden">
      {props.children}
    </box>
  )
}

const PROMPT_MAX_CHARS = 240
const REPLY_MAX_LINES = 12
const REPLY_MAX_CHARS = 800

function Exchange(props: { exchange: { user?: WithParts; assistant?: WithParts } }) {
  const { theme, syntax } = useTheme()
  const userText = createMemo(() =>
    props.exchange.user ? extractMessageText(props.exchange.user.parts, PROMPT_MAX_CHARS) : undefined,
  )
  const assistantMarkdown = createMemo(() =>
    props.exchange.assistant
      ? extractMessageMarkdown(props.exchange.assistant.parts, REPLY_MAX_LINES, REPLY_MAX_CHARS)
      : undefined,
  )

  return (
    <box flexDirection="column" gap={1}>
      <Show when={userText()}>
        <text fg={theme.textMuted} wrapMode="word">
          <span style={{ fg: theme.textMuted }}>› </span>
          {userText()!}
        </text>
      </Show>
      <Show when={assistantMarkdown()}>
        <markdown
          content={assistantMarkdown()!}
          syntaxStyle={syntax()}
          streaming={false}
          internalBlockMode="top-level"
          tableOptions={{ style: "columns" }}
          conceal={false}
          fg={theme.markdownText}
          bg={theme.backgroundPanel}
        />
      </Show>
      <Show when={!userText() && !assistantMarkdown()}>
        <NonTextHint exchange={props.exchange} />
      </Show>
    </box>
  )
}

function NonTextHint(props: { exchange: { user?: WithParts; assistant?: WithParts } }) {
  const { theme } = useTheme()
  const summary = createMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of [props.exchange.user, props.exchange.assistant]) {
      if (!item) continue
      for (const part of item.parts) {
        counts[part.type] = (counts[part.type] ?? 0) + 1
      }
    }
    return Object.entries(counts)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ")
  })
  return (
    <text fg={theme.textMuted} wrapMode="word">
      <Show when={summary()} fallback="No text content in the latest messages">
        Latest exchange has no text content ({summary()})
      </Show>
    </text>
  )
}
