import { base64Encode } from "@opencode-ai/util/encode"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useParams, useSearchParams } from "@solidjs/router"
import { createMemo, createResource, createRoot, getOwner, onCleanup } from "solid-js"
import { requireServerKey } from "@/shell/routes/session"
import { ServerConnection } from "@/runtime/server/registry"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useTabs, type Tab } from "@/shell/tabs/tabs"
import type { ServerScope } from "@/runtime/server/scope"
import {
  createComposerReady,
  createComposerState,
  type ContextItem,
  type FileContextItem,
  type Prompt,
  type PromptModel,
  type PromptScope,
  type ComposerState,
} from "./state"

export {
  createComposerReady,
  createComposerState,
  createMemoryComposerState,
  DEFAULT_PROMPT,
  isCommentItem,
} from "./state"
export type {
  AgentPart,
  ContentPart,
  ContextItem,
  FileAttachmentPart,
  FileContextItem,
  ImageAttachmentPart,
  Prompt,
  PromptModel,
  ComposerStore,
  PromptScope,
  ComposerState,
  TextPart,
} from "./state"

const WORKSPACE_KEY = "__workspace__"
const MAX_PROMPT_SESSIONS = 20

export function selectPromptTab(tabs: Tab[], scope: PromptScope, server: ServerConnection.Key) {
  if ("draftID" in scope) return tabs.find((tab) => tab.type === "draft" && tab.draftID === scope.draftID)
  if (!scope.id) return
  return (
    tabs.find((tab) => tab.type === "session" && tab.server === server && tab.sessionId === scope.id) ??
    ({ type: "session", server, sessionId: scope.id } satisfies Tab)
  )
}

function scopeKey(scope: PromptScope) {
  if ("draftID" in scope) return `draft:${scope.draftID}`
  return `${scope.dir}:${scope.id ?? WORKSPACE_KEY}`
}

type ComposerCacheEntry = {
  value: ComposerState
  dispose: VoidFunction
}

export const createTabComposerState = (
  tabs: ReturnType<typeof useTabs>,
  tab: Tab,
  ...args: Parameters<typeof createComposerState>
) => tabs.state(tab, "prompt", () => createComposerState(...args))

export const { use: useComposerState, provider: ComposerPersistenceProvider } = createSimpleContext({
  name: "ComposerState",
  gate: false,
  init: () => {
    const params = useParams<{ serverKey?: string; id?: string }>()
    const sdk = useWorkspaceLocation()
    const [search] = useSearchParams<{ draftId?: string }>()
    const serverSDK = useServerSDK()
    const tabs = useTabs()
    const cache = new Map<string, ComposerCacheEntry>()

    const disposeAll = () => {
      for (const entry of cache.values()) entry.dispose()
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_PROMPT_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const owner = getOwner()
    const serverKey = () =>
      params.serverKey ? requireServerKey(params.serverKey) : ServerConnection.key(serverSDK.server)
    const scope = (): PromptScope =>
      search.draftId ? { draftID: search.draftId } : { dir: base64Encode(sdk().directory), id: params.id }
    const load = (scope: PromptScope, target?: { server?: ServerConnection.Key; scope: ServerScope }) => {
      const current = selectPromptTab(tabs.store, scope, target?.server ?? serverKey())
      if (current) return createTabComposerState(tabs, current, target?.scope ?? serverSDK.scope, scope)

      const key = target ? `${target.scope}:${scopeKey(scope)}` : scopeKey(scope)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot(
        (dispose) => ({
          value: createComposerState(target?.scope ?? serverSDK.scope, scope),
          dispose,
        }),
        owner,
      )

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const session = createMemo(() => load(scope()))
    const pick = (scope?: PromptScope, target?: { server?: ServerConnection.Key; scope: ServerScope }) =>
      scope ? load(scope, target) : session()
    const ready = createComposerReady(session)

    const withSuspense = <T,>(cb: () => T): (() => T) =>
      createResource(
        async () => {
          const value = cb()
          await session().ready.promise
          return value
        },
        cb,
        { initialValue: cb() },
      )[0]

    return {
      ready,
      capture: (scope?: PromptScope, target?: { server?: ServerConnection.Key; scope: ServerScope }) =>
        pick(scope, target).capture(),
      current: withSuspense(() => session().current()),
      cursor: withSuspense(() => session().cursor()),
      model: {
        current: withSuspense(() => session().model.current()),
        set: (model: PromptModel | undefined) => session().model.set(model),
      },
      context: {
        items: withSuspense(() => session().context.items()),
        add: (item: ContextItem) => session().context.add(item),
        remove: (key: string) => session().context.remove(key),
        removeComment: (path: string, commentID: string) => session().context.removeComment(path, commentID),
        updateComment: (path: string, commentID: string, next: Partial<FileContextItem> & { comment?: string }) =>
          session().context.updateComment(path, commentID, next),
        replaceComments: (items: FileContextItem[]) => session().context.replaceComments(items),
      },
      set: (prompt: Prompt, cursorPosition?: number, scope?: PromptScope) => pick(scope).set(prompt, cursorPosition),
      reset: (scope?: PromptScope) => pick(scope).reset(),
    }
  },
})
