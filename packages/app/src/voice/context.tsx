import { createSimpleContext } from "@opencode/ui/context"
import { useLocation, useNavigate } from "@solidjs/router"
import { createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { usePlatform } from "@/runtime/platform/platform"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { findSessionTab, useTabs } from "@/shell/tabs/tabs"
import type { createVoiceCall } from "./call"
import {
  createVoiceCallState,
  isConnecting,
  transitionVoiceCall,
  voiceCallView,
  type VoiceCallEffect,
  type VoiceCallEvent,
} from "./call-machine"

export const { provider: VoiceProvider, use: useVoice } = createSimpleContext({
  name: "Voice",
  init: () => {
    const platform = usePlatform()
    const navigate = useNavigate()
    const location = useLocation()
    const tabs = useTabs()

    const [call, setCall] = createSignal(createVoiceCallState<ServerCtx>())
    const view = createMemo(() => voiceCallView(call()))

    // The call's transports and tools, loaded on its first connect and kept across Rejoin.
    let session: ReturnType<typeof createVoiceCall> | undefined
    // The latest transport close; the next join waits for it so the active-call IPC is released in order.
    let closing: Promise<unknown> = Promise.resolve()

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

    const dispatch = (event: VoiceCallEvent<ServerCtx>) => {
      const current = untrack(call)
      const next = transitionVoiceCall(current, event)

      if (next.state !== current) setCall(next.state)
      next.effects.forEach(perform)
    }

    const perform = (effect: VoiceCallEffect<ServerCtx>) => {
      if (effect.type === "connect") return connect(effect)

      if (effect.type === "teardown") return teardown(effect)

      if (effect.type === "disconnect") {
        closing = Promise.all([closing, session?.disconnect(effect.attempt)])

        return
      }

      if (effect.type === "activate") return session?.activate(effect.attempt, effect.sync)

      if (effect.type === "instructions") return session?.instructions(effect.attempt, effect.viewing)
      session?.mute(effect.attempt, effect.muted)
    }

    const connect = (effect: Extract<VoiceCallEffect<ServerCtx>, { type: "connect" }>) => {
      const timer = setTimeout(() => dispatch({ type: "connect.timeout", attempt: effect.attempt }), effect.timeout)
      void closing
        .then(() => import("./call"))
        .then(({ createVoiceCall }) => {
          // A call that ended while the module loaded must not leave a session listening behind it.
          if (!isConnecting(untrack(call), effect.attempt)) return
          session ??= createVoiceCall({
            ctx: effect.ctx,
            platform,
            open: async (next, signal) => {
              const href = sessionHref(effect.server, next.id)

              // Subagent sessions open inside their root session's tab, which the titlebar finds from the route.
              const tab =
                findSessionTab(tabs.store, effect.server, next.id) ??
                (next.parentID ? undefined : tabs.addSessionTab({ server: effect.server, sessionId: next.id }))

              if (tab) tabs.remember(tab)
              navigate(href)
              await routed(href, signal)
              // A call that ended or dropped mid-open must not take over the view.
              signal.throwIfAborted()
              dispatch({ type: "session.viewed", server: effect.server, session: { id: next.id, title: next.title } })
            },
            tabs: () =>
              tabs.store.flatMap((tab) =>
                tab.type === "session" && tab.server === effect.server ? [tab.sessionId] : [],
              ),
            call: () => untrack(call),
            dispatch,
          })

          return session.connect(effect.attempt, effect.viewing, effect.muted)
        })
        .catch(() => dispatch({ type: "connect.failed", attempt: effect.attempt, failure: "connection" }))
        .finally(() => clearTimeout(timer))
    }

    const teardown = (effect: Extract<VoiceCallEffect<ServerCtx>, { type: "teardown" }>) => {
      const done = Promise.all([closing, session?.dispose()])
      const timer = setTimeout(() => dispatch({ type: "end.timeout", attempt: effect.attempt }), effect.timeout)
      session = undefined
      closing = done
      void done.then(() => {
        clearTimeout(timer)
        dispatch({ type: "end.settled", attempt: effect.attempt })
      })
    }

    const end = () => dispatch({ type: "end" })

    window.addEventListener("pagehide", end)
    window.addEventListener("beforeunload", end)
    onCleanup(() => {
      window.removeEventListener("pagehide", end)
      window.removeEventListener("beforeunload", end)
      dispatch({ type: "disposed" })
    })

    return {
      view,
      end,
      mute: () => dispatch({ type: "mute.toggled" }),
      rejoin: () => dispatch({ type: "rejoin" }),
      /** Tells the call which session is on screen; ignored unless a call on that server is open. */
      syncSession(server: ServerConnection.Key, session: SessionInfo) {
        dispatch({ type: "session.viewed", server, session: { id: session.id, title: session.title } })
      },
      start(server: ServerConnection.Key, ctx: ServerCtx, session: SessionInfo) {
        dispatch({ type: "start", server, ctx, session: { id: session.id, title: session.title } })
      },
    }
  },
})
