import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { getFilename } from "@opencode/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useTabs } from "@/shell/tabs/tabs"
import {
  INITIAL_DEEP_LINK_STATE,
  transitionDeepLinks,
  type DeepLink,
  type DeepLinkEffect,
  type DeepLinkEvent,
} from "./machine"

/** Opens the `opencode://` links the desktop app receives, for as long as the shell lives. */
export function useDeepLinks() {
  const platform = usePlatform()
  const servers = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const dialog = useDialog()

  const own = createMemo(() => servers.list.find(ServerConnection.builtin))

  // The app's own server can open projects: connected, with its project list loaded.
  const ready = createMemo(() => {
    const conn = own()
    const ctx = conn && global.serverCtx(ServerConnection.key(conn))

    return !!ctx && ctx.sdk.connection.status() === "connected" && ctx.sync.project.ready()
  })

  const machine = { state: INITIAL_DEEP_LINK_STATE }

  const dispatch = (event: DeepLinkEvent) => {
    const next = transitionDeepLinks(machine.state, event)
    machine.state = next.state
    next.effects.forEach(run)
  }

  // Each link opens after the one before it, so the tabs open in the order the links came and the last one is in front.
  const opening = { last: Promise.resolve() }

  const run = (effect: DeepLinkEffect) => {
    if (effect.type === "ask") return ask(effect)

    open(effect.link)
  }

  // Accepting closes the dialog, which reports a decline as it starts closing; the attempt makes that harmless.
  const ask = (effect: Extract<DeepLinkEffect, { type: "ask" }>) => {
    const attempt = effect.attempt

    void dialog.push(
      () => <DialogOpenDeepLink link={effect.link} onOpen={() => dispatch({ type: "link.accepted", attempt })} />,
      () => dispatch({ type: "link.declined", attempt }),
    )
  }

  // A project that can't be added shows the server's error (`projects.add`); one that can opens in a new session.
  const open = (link: DeepLink) => {
    const conn = untrack(own)

    if (!conn) return
    const server = ServerConnection.key(conn)
    const ctx = untrack(() => global.serverCtx(server))

    if (!ctx) return

    opening.last = opening.last.then(async () => {
      const project = await ctx.projects.add(link.directory)

      if (!project) return

      const prompt = link.type === "new-session" ? link.prompt : undefined

      await tabs.newDraft({ server, directory: project.worktree }, prompt)
    })
    // A tab that failed to open must not stop the links after it.
    opening.last = opening.last.catch(() => undefined)
  }

  createEffect(() => {
    const event: DeepLinkEvent = ready() ? { type: "server.ready" } : { type: "server.lost" }
    untrack(() => dispatch(event))
  })

  const stop = platform.onDeepLinks?.((urls) => dispatch({ type: "links.received", urls }))

  if (stop) onCleanup(stop)
}

function DialogOpenDeepLink(props: { link: DeepLink; onOpen: () => void }) {
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
