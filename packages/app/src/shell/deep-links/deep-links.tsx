import { createEffect, createMemo, onCleanup, untrack, type Accessor } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { getFilename } from "@opencode/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { isSessionNotFoundError } from "@/runtime/server/errors"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { showToast } from "@/shell/notifications/toast"
import { useCurrentRoute } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import {
  INITIAL_DEEP_LINK_STATE,
  transitionDeepLinks,
  type DeepLinkEffect,
  type DeepLinkEvent,
  type DirectoryDeepLink,
  type SessionDeepLink,
} from "./machine"
import { openSessionDeepLink } from "./session"

/** Runs the deep-link state machine for the current reactive owner, subscribing to queued and live links. */
export function createDeepLinksDriver(input: {
  readonly onDeepLinks?: (listener: (urls: string[]) => void) => () => void
  readonly directoryReady: Accessor<boolean>
  readonly sessionsReady: Accessor<boolean>
  readonly ask: (effect: Extract<DeepLinkEffect, { type: "ask" }>, dispatch: (event: DeepLinkEvent) => void) => void
  readonly openDirectory: (link: DirectoryDeepLink, signal: AbortSignal) => Promise<void>
  readonly openSession: (link: SessionDeepLink, signal: AbortSignal) => Promise<void>
}) {
  const machine = { state: INITIAL_DEEP_LINK_STATE }
  const lifecycle = new AbortController()

  const dispatch = (event: DeepLinkEvent) => {
    if (lifecycle.signal.aborted) return
    const next = transitionDeepLinks(machine.state, event)
    machine.state = next.state
    next.effects.forEach(run)
  }

  // Each link opens after the one before it, so the tabs open in the order the links came and the last one is in front.
  const opening = { last: Promise.resolve() }

  const enqueue = (task: (signal: AbortSignal) => Promise<void>) => {
    opening.last = opening.last.then(() => {
      if (lifecycle.signal.aborted) return

      return task(lifecycle.signal)
    })
    // A tab that failed to open must not stop the links after it.
    opening.last = opening.last.catch(() => undefined)
  }

  const run = (effect: DeepLinkEffect) => {
    if (effect.type === "ask") return input.ask(effect, dispatch)

    if (effect.link.type === "session") {
      const link = effect.link

      return enqueue((signal) => input.openSession(link, signal))
    }

    const link = effect.link
    enqueue((signal) => input.openDirectory(link, signal))
  }

  createEffect(() => {
    const event: DeepLinkEvent = input.directoryReady() ? { type: "server.ready" } : { type: "server.lost" }
    untrack(() => dispatch(event))
  })

  createEffect(() => {
    const event: DeepLinkEvent = input.sessionsReady() ? { type: "sessions.ready" } : { type: "sessions.lost" }
    untrack(() => dispatch(event))
  })

  const stop = input.onDeepLinks?.((urls) => dispatch({ type: "links.received", urls }))

  onCleanup(() => {
    lifecycle.abort()
    stop?.()
  })
}

/** Opens the `opencode://` links the desktop app receives, for as long as the shell lives. */
export function useDeepLinks() {
  const platform = usePlatform()
  const servers = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const dialog = useDialog()
  const language = useLanguage()
  const currentRoute = useCurrentRoute()

  const own = createMemo(() => servers.list.find(ServerConnection.builtin))

  // The app's own server can open projects: connected, with its project list loaded.
  const directoryReady = createMemo(() => {
    const conn = own()
    const ctx = conn && global.serverCtx(ServerConnection.key(conn))

    return !!ctx && ctx.sdk.connection.status() === "connected" && ctx.sync.project.ready()
  })

  // Session links wait for persisted servers to hydrate and at least one configured server to have an HTTP endpoint.
  const sessionsReady = createMemo(
    () => servers.hydrated() && servers.list.some((conn) => !!ServerConnection.http(conn)),
  )

  const activeServer = (): ServerConnection.Key | undefined => {
    const route = untrack(currentRoute)

    if (route.type === "session") return route.server

    if (route.type === "draft") {
      const draft = tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)

      if (draft) return draft.server
    }

    const recent = untrack(tabs.recentKey)

    if (!recent) return

    return tabs.store.find((tab) => tabKey(tab) === recent)?.server
  }

  createDeepLinksDriver({
    onDeepLinks: platform.onDeepLinks,
    directoryReady,
    sessionsReady,
    // Accepting closes the dialog, which reports a decline as it starts closing; the attempt makes that harmless.
    ask: (effect, dispatch) => {
      const attempt = effect.attempt

      void dialog.push(
        () => <DialogOpenDeepLink link={effect.link} onOpen={() => dispatch({ type: "link.accepted", attempt })} />,
        () => dispatch({ type: "link.declined", attempt }),
      )
    },
    // A project that can't be added shows the server's error (`projects.add`); one that can opens in a new session.
    openDirectory: async (link, signal) => {
      const conn = untrack(own)

      if (!conn) return
      const server = ServerConnection.key(conn)
      const ctx = untrack(() => global.serverCtx(server))

      if (!ctx) return
      const project = await ctx.projects.add(link.directory)

      if (!project || signal.aborted) return
      const prompt = link.type === "new-session" ? link.prompt : undefined

      await tabs.newDraft({ server, directory: project.worktree }, prompt)
    },
    openSession: async (link, signal) => {
      const outcome = await openSessionDeepLink(
        link,
        {
          servers: untrack(() => servers.list),
          activeServer: activeServer(),
          cached: (server, sessionID) => untrack(() => global.serverCtx(server)?.data.session.get(sessionID)),
          fetch: async (server, sessionID, fetchSignal) => {
            const conn = untrack(() => servers.list.find((item) => ServerConnection.key(item) === server))
            const ctx = untrack(() => global.serverCtx(server))

            if (!conn || !ServerConnection.http(conn) || !ctx) return { status: "unavailable" }

            return ctx.sdk.api.session.get({ sessionID }, { signal: fetchSignal }).then(
              (session) => {
                ctx.data.session.remember(session)

                return { status: "found" as const, session }
              },
              (cause: unknown) =>
                isSessionNotFoundError(cause, sessionID)
                  ? { status: "not-found" as const }
                  : { status: "unavailable" as const },
            )
          },
        },
        tabs,
        signal,
      )

      if (signal.aborted || outcome.status === "cancelled") return

      if (outcome.status === "opened") {
        const ctx = untrack(() => global.serverCtx(outcome.server))
        const info = outcome.session ? ctx?.data.session.get(outcome.session.id) : undefined

        if (ctx && info) ctx.projects.touch(ctx.projects.forSession(info)?.worktree ?? info.location.directory)

        return
      }

      showToast({ title: language.t("session.error.notFound") })
    },
  })
}

function DialogOpenDeepLink(props: { link: DirectoryDeepLink; onOpen: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  const accept = () => {
    props.onOpen()
    dialog.close()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("deepLink.open.title", { name: getFilename(props.link.directory) })}
          description={
            <div class="flex flex-col gap-2">
              <div>{language.t("deepLink.open.description")}</div>
              <div class="flex flex-col gap-1">
                <span class="text-11-regular text-v2-text-text-faint">{language.t("deepLink.open.folder")}</span>
                <code
                  dir="ltr"
                  class="block w-fit max-w-full rounded-[4px] bg-[color-mix(in_oklch,var(--v2-text-text-base)_8%,transparent)] px-1 py-0.5 font-mono text-xs font-medium leading-4 text-v2-text-text-base break-all"
                >
                  {props.link.directory}
                </code>
              </div>
              <div>{language.t("deepLink.open.warning")}</div>
            </div>
          }
        />
      </DialogHeader>
      <DialogFooter>
        {/* Cancel has focus, so a link can't open a folder on a stray Enter. */}
        <Button type="button" variant="neutral" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant="contrast" onClick={accept}>
          {language.t("deepLink.open.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
