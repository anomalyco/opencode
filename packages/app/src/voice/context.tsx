import { createSimpleContext } from "@opencode/ui/context"
import { useLocation, useNavigate } from "@solidjs/router"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode/client/promise"
import { usePlatform } from "@/runtime/platform/platform"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { findSessionTab, useTabs } from "@/shell/tabs/tabs"
import type { CallState, createVoiceCall } from "./call"

export const { provider: VoiceProvider, use: useVoice } = createSimpleContext({
  name: "Voice",
  init: () => {
    const platform = usePlatform()
    const navigate = useNavigate()
    const location = useLocation()
    const tabs = useTabs()

    const [state, setState] = createStore<
      CallState & {
        server?: ServerConnection.Key
        captions: { utterance: number; speaker: CallState["speaker"]; text: string }[]
      }
    >({
      status: "idle",
      muted: false,
      level: 0,
      caption: "",
      speaker: "assistant",
      title: "",
      captions: [],
    })

    const current: { call?: ReturnType<typeof createVoiceCall>; generation: number } = { generation: 0 }

    // Resolves once the router shows href; voice must not report a move that didn't happen.
    const routed = (href: string, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now()

        const check = () => {
          if (signal.aborted) return reject(signal.reason)

          if (location.pathname === href) return resolve()

          if (Date.now() - started > 3000) return reject(new Error("Desktop did not show the session"))
          setTimeout(check, 50)
        }

        check()
      })

    const end = async () => {
      const generation = ++current.generation
      const call = current.call
      current.call = undefined
      await call?.end()

      if (current.generation === generation)
        setState({ status: "idle", server: undefined, caption: "", captions: [], level: 0, muted: false })
    }

    const unload = () => {
      void end()
    }

    window.addEventListener("pagehide", unload)
    window.addEventListener("beforeunload", unload)
    onCleanup(() => {
      window.removeEventListener("pagehide", unload)
      window.removeEventListener("beforeunload", unload)
      void end()
    })

    // The call reports each utterance as it grows: its line is extended in place, and the next utterance starts a
    // new one.
    const caption = (change: Partial<CallState>) => {
      const text = change.caption
      const utterance = change.utterance

      if (!text || utterance === undefined) return
      const last = state.captions.length - 1

      if (state.captions[last]?.utterance === utterance) return setState("captions", last, "text", text)
      setState("captions", (list) => [...list, { utterance, speaker: state.speaker, text }].slice(-4))
    }

    return {
      state,
      end,
      mute: () => current.call?.mute(),
      rejoin: () => current.call?.join(),
      view(server: ServerConnection.Key, session: SessionInfo) {
        if (state.server === server) current.call?.view(session)
      },
      async start(server: ServerConnection.Key, ctx: ServerCtx, session: SessionInfo) {
        if (state.status !== "idle") return
        const generation = ++current.generation
        setState({
          status: "connecting",
          server,
          title: session.title ?? session.id,
          failure: undefined,
          caption: "",
          captions: [],
        })
        await import("./call")
          .then(async ({ createVoiceCall }) => {
            if (current.generation !== generation) return
            current.call = createVoiceCall({
              ctx,
              session,
              platform,
              open: async (next, signal) => {
                const href = sessionHref(server, next.id)
                // Subagent sessions open inside their root session's tab, which the titlebar finds from the route.
                const tab =
                  findSessionTab(tabs.store, server, next.id) ??
                  (next.parentID ? undefined : tabs.addSessionTab({ server, sessionId: next.id }))

                if (tab) tabs.remember(tab)
                navigate(href)
                await routed(href, signal)
              },
              tabs: () =>
                tabs.store.flatMap((tab) => (tab.type === "session" && tab.server === server ? [tab.sessionId] : [])),
              change: (change) => {
                if (current.generation !== generation) return
                setState(change)
                caption(change)
              },
            })
            await current.call.join()
          })
          .catch(() => {
            if (current.generation === generation) setState({ status: "dropped", failure: "connection" })
          })
      },
    }
  },
})
