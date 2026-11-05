import { type Accessor, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import type { ServerCtx } from "@/runtime/server/runtime"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"
import { useDialog } from "@opencode/ui/context/dialog"
import { uuid } from "@opencode/util/uuid"
import {
  createMcpState,
  type McpEffect,
  type McpEvent,
  type McpServerStatus,
  type McpState,
  transitionMcp,
} from "./mcp-machine"
import { DialogMcpSignIn } from "./mcp-sign-in"

export type McpControls = {
  readonly preview: boolean
  readonly states: Readonly<Record<string, boolean>>
  readonly pending: boolean
  change: (name: string, enabled: boolean) => void
}

/** The MCP machine of one server connection and directory, and the effects it drives. */
export type McpController = {
  readonly state: Accessor<McpState>
  dispatch: (event: McpEvent) => void
  /** Toggles a server and resolves whether it succeeded; joins a toggle of the same server already running. */
  toggle: (name: string, enabled: boolean, status: McpServerStatus["status"] | undefined) => Promise<boolean>
  /** Resolves once every running toggle ended, with whether all succeeded. */
  settle: () => Promise<boolean>
  /** Listens for focus moves of the MCPs dialog's error view. */
  onFocus: (listener: (effect: Extract<McpEffect, { type: "focus-detail" | "focus-list" }>) => void) => () => void
}

// Controllers by server connection and directory, so the MCPs dialog, Settings and the composer share toggles: closing
// the dialog while a server connects keeps it busy in Settings and when the dialog opens again.
const pools = new WeakMap<ServerCtx, Map<string, McpController>>()

/** The controller for `directory` (the default location when omitted), held for as long as the caller lives. */
export function useMcpController(directory?: Accessor<string | undefined>) {
  const pool = useMcpPool()
  const data = useServer().ctx.data
  const resolved = createMemo(() => directory?.() ?? data.location.default().directory)

  const controller = createMemo(() => {
    const current = pool.acquire(resolved())
    onCleanup(() => current.dispatch({ type: "unmounted" }))

    return current
  })

  return {
    directory: resolved,
    state: () => controller().state(),
    dispatch: (event: McpEvent) => controller().dispatch(event),
    controller,
  }
}

/** Every directory's controller on the current server connection. */
export function useMcpPool() {
  const ctx = useServer().ctx
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()
  const controllers = pools.get(ctx) ?? new Map<string, McpController>()
  pools.set(ctx, controllers)

  const get = (directory: string) => {
    const current = controllers.get(directory)

    if (current && untrack(current.state).status !== "disposed") return current

    const created = createMcpController({ ctx, directory, platform, language, dialog }, () => {
      if (controllers.get(directory) === created) controllers.delete(directory)
    })

    controllers.set(directory, created)

    return created
  }

  return {
    /** Mounts the directory's controller; the caller dispatches `unmounted` when done with it. */
    acquire: (directory: string) => {
      const current = get(directory)
      current.dispatch({ type: "mounted" })

      return current
    },
    /** The directory's live controller, if any. */
    peek: (directory: string) => {
      const current = controllers.get(directory)

      return current && untrack(current.state).status !== "disposed" ? current : undefined
    },
  }
}

// Connects, disconnects, or starts sign-in for one server connection's MCPs in one directory, and shows their
// errors. It ends once nothing lists it, no toggle runs and no error view shows.
function createMcpController(
  input: {
    ctx: ServerCtx
    directory: string
    platform: ReturnType<typeof usePlatform>
    language: ReturnType<typeof useLanguage>
    dialog: ReturnType<typeof useDialog>
  },
  release: () => void,
): McpController {
  const [mcpState, setMcpState] = createSignal(createMcpState())

  const runs = new Map<
    number,
    { controller: AbortController; timer: ReturnType<typeof setTimeout>; done: PromiseWithResolvers<boolean> }
  >()

  const listeners = new Set<Parameters<McpController["onFocus"]>[0]>()
  const ref = { directory: input.directory }

  const dispatch = (event: McpEvent) => {
    const previous = untrack(mcpState)
    const next = transitionMcp(previous, event)

    if (next.state !== previous) setMcpState(next.state)

    if (next.state.status === "disposed" && previous.status !== "disposed") release()
    next.effects.forEach(
      (effect) => void Promise.try(() => run(effect)).catch((cause: unknown) => console.error(cause)),
    )
  }

  const run = (effect: McpEffect) => {
    if (effect.type === "run-toggle") {
      const name = effect.name
      const attempt = effect.attempt
      const controller = new AbortController()

      runs.set(attempt, {
        controller,
        timer: setTimeout(() => dispatch({ type: "toggle.timed-out", name, attempt }), effect.timeoutMs),
        done: Promise.withResolvers<boolean>(),
      })
      void toggle(effect, controller.signal).then(dispatch, (error) =>
        dispatch({
          type: "toggle.failed",
          name,
          attempt,
          error: error instanceof Error ? error.message : String(error),
          server: false,
        }),
      )

      return
    }

    if (effect.type === "end-toggle") {
      const handle = runs.get(effect.attempt)
      runs.delete(effect.attempt)
      clearTimeout(handle?.timer)
      handle?.controller.abort()
      handle?.done.resolve(effect.ok)

      return
    }

    if (effect.type === "open-external") return input.platform.openExternal(effect.url)

    if (effect.type === "open-sign-in") {
      const signIn = effect.signIn
      const dialogID = uuid()
      void input.dialog.push(
        () => (
          <DialogMcpSignIn
            name={effect.name}
            integrationID={signIn.integrationID}
            attemptID={signIn.attemptID}
            url={signIn.url}
            lifetime={signIn.lifetime}
            location={ref}
            onDone={async () => {
              const data = input.ctx.data
              data.location.mcp.server.invalidate(ref)
              data.location.mcp.resource.invalidate(ref)
              await Promise.all([data.location.mcp.server.sync(ref), data.location.mcp.resource.sync(ref)])
              input.dialog.close(dialogID)
            }}
          />
        ),
        undefined,
        dialogID,
      )

      return
    }

    if (effect.type === "focus-detail" || effect.type === "focus-list")
      return listeners.forEach((listener) => listener(effect))

    showToast({
      variant: "error",
      title: input.language.t("common.requestFailed"),
      description:
        effect.type === "toast-failed" ? effect.message : input.language.t("mcp.timedOut", { name: effect.name }),
    })
  }

  const toggle = async (effect: Extract<McpEffect, { type: "run-toggle" }>, signal: AbortSignal): Promise<McpEvent> => {
    const api = input.ctx.sdk.api
    const data = input.ctx.data
    const name = effect.name
    const attempt = effect.attempt
    const found = (await api.mcp.list({ location: ref }, { signal })).data.find((item) => item.name === name)

    if (!found) return { type: "toggle.succeeded", name, attempt }

    if (!effect.enabled) await api.experimental.mcp.disconnect({ server: name, location: ref }, { signal })

    if (effect.enabled && found.status.status !== "needs_auth")
      await api.experimental.mcp.connect({ server: name, location: ref }, { signal })

    data.location.mcp.server.invalidate(ref)
    await data.location.mcp.server.sync(ref)
    const current = data.location.mcp.server.list(ref)?.find((item) => item.name === name)
    const integrationID = current?.integrationID

    if (effect.enabled && current?.status.status === "needs_auth" && integrationID) {
      const integration = await api.integration.get({ integrationID, location: ref }, { signal })
      const method = integration.data?.methods.find((item) => item.type === "oauth" && !item.form?.length)

      if (!method || method.type !== "oauth") throw new Error(input.language.t("mcp.auth.interactiveForm", { name }))

      const started = await api.integration.oauth.connect(
        { integrationID, methodID: method.id, location: ref },
        { signal },
      )

      dispatch({
        type: "toggle.authorizing",
        name,
        attempt,
        url: started.data.url,
        signIn: started.data.paste
          ? {
              integrationID,
              attemptID: started.data.attemptID,
              url: started.data.url,
              lifetime: started.data.time.expires - started.data.time.created,
            }
          : undefined,
      })
    }

    data.location.mcp.resource.invalidate(ref)
    await data.location.mcp.resource.sync(ref)
    // A successful HTTP response can still leave the MCP connection in a failed state.
    const status = current?.status

    if (status?.status === "failed") return { type: "toggle.failed", name, attempt, error: status.error, server: true }

    return { type: "toggle.succeeded", name, attempt }
  }

  const running = (name: string) => {
    const state = untrack(mcpState)
    const attempt = state.status === "active" ? state.toggles.find((item) => item.name === name)?.attempt : undefined

    return attempt === undefined ? undefined : runs.get(attempt)?.done.promise
  }

  return {
    state: mcpState,
    dispatch,
    toggle: (name, enabled, status) => {
      const joined = running(name)

      if (joined) return joined
      dispatch({ type: "toggle.requested", name, enabled, status })

      return running(name) ?? Promise.resolve(false)
    },
    settle: () =>
      Promise.all([...runs.values()].map((handle) => handle.done.promise)).then((results) => results.every(Boolean)),
    onFocus: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }
}
