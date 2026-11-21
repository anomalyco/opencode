import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { ErrorDetails } from "@opencode/ui/error-details"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Menu } from "@opencode/ui/menu"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { getFilename } from "@opencode/util/path"
import {
  createMemo,
  createRoot,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
  type ComponentProps,
  type JSX,
} from "solid-js"
import {
  createKeyed,
  usePlugin,
  type DialogHandle,
  type MountedSession,
  type Project,
  type ServerRef,
} from "@opencode/plugin/gui"
import {
  createWorkspaceMoveState,
  transitionWorkspaceMove,
  workspaceDialogView,
  workspaceMenuView,
  type WorkspaceDialogView,
  type WorkspaceMoveEffect,
  type WorkspaceMoveEvent,
  type WorkspaceMoveFailure,
  type WorkspaceMoveState,
  type WorkspaceMoveTarget,
} from "./workspace-move-machine"

export function SessionWorkspaceMenu(props: {
  session: MountedSession
  project: Project
  directory: string
  /** The plugin's move controllers, so a menu that mounts again finds the move or dialog the last one left running. */
  moves: WorkspaceMoveControllers
  placement?: ComponentProps<typeof Menu>["placement"]
  class?: string
  /** Renders as a submenu of an enclosing `Menu`. */
  sub?: boolean
  children: JSX.Element
}) {
  const ctx = usePlugin()
  const move = useWorkspaceMoveController(props.moves, props.session, props.project.id)
  const running = () => props.session.server.data.session.status(props.session.id) === "running"
  const view = createMemo(() => workspaceMenuView(move.state(), props.directory, props.project, running()))

  const onOpenChange = (open: boolean) => {
    if (open) move.dispatch({ type: "menu.opened", projectID: props.project.id })
  }

  const request = (target: WorkspaceMoveTarget) =>
    move.dispatch({ type: "move.requested", target, running: running() })

  const items = () => (
    <Menu.Group>
      <Menu.GroupLabel>{ctx.t("move.menu")}</Menu.GroupLabel>
      <Show when={view().showLocal}>
        <Menu.Item
          disabled={view().disabled}
          onSelect={() => request({ type: "existing", directory: props.project.worktree })}
        >
          <Icon name="monitor" class="text-v2-icon-icon-muted" />
          {ctx.t("workspace.local")}
        </Menu.Item>
      </Show>
      <Menu.Item
        disabled={view().disabled}
        onSelect={() => request({ type: "create", sourceDirectory: props.directory })}
      >
        <Icon name="plus" class="text-v2-icon-icon-muted" />
        {ctx.t("workspace.new")}
      </Menu.Item>
      <Show when={view().workspaces.length > 0}>
        <Menu.Sub gutter={0} overlap overflowPadding={24}>
          <Menu.SubTrigger class="[&_[data-slot=menu-v2-item-chevron]]:text-v2-icon-icon-muted">
            <Icon name="outline-worktree" class="text-v2-icon-icon-muted" />
            {ctx.t("workspace.existing")}
          </Menu.SubTrigger>
          <Menu.Portal>
            <Menu.SubContent class="max-h-[66.667dvh] w-[200px] !p-0 [@media(max-height:600px)]:max-h-[calc(100dvh-48px)]">
              <MenuScroll viewportClass="p-0.5">
                <For each={view().workspaces}>
                  {(workspace) => (
                    <Menu.Item
                      disabled={view().disabled}
                      onSelect={() => request({ type: "existing", directory: workspace })}
                    >
                      <Icon name="outline-worktree" class="text-v2-icon-icon-muted" />
                      <span class="min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                    </Menu.Item>
                  )}
                </For>
              </MenuScroll>
            </Menu.SubContent>
          </Menu.Portal>
        </Menu.Sub>
      </Show>
    </Menu.Group>
  )

  if (props.sub)
    return (
      <Menu.Sub gutter={4} overflowPadding={24} onOpenChange={onOpenChange}>
        <Menu.SubTrigger
          class="[&_[data-slot=menu-v2-item-chevron]]:text-v2-icon-icon-muted"
          disabled={view().disabled}
        >
          {props.children}
        </Menu.SubTrigger>
        <Menu.Portal>
          <Menu.SubContent class="w-[200px]">{items()}</Menu.SubContent>
        </Menu.Portal>
      </Menu.Sub>
    )

  return (
    <Menu
      placement={props.placement ?? "bottom-end"}
      gutter={4}
      overflowPadding={24}
      modal={false}
      onOpenChange={onOpenChange}
    >
      <Menu.Trigger class={props.class} disabled={view().disabled}>
        {props.children}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content class="w-[200px]">{items()}</Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

type WorkspaceMoveController = {
  readonly state: () => WorkspaceMoveState
  dispatch: (event: WorkspaceMoveEvent) => void
  /** Closes the recovery dialog of `attempt`, if it still shows, and reports that it closed. */
  dismiss: (attempt: number) => void
}

/**
 * The plugin instance's move controllers, by `MountedSession.key`, so the location menu, which unmounts as soon as
 * the user picks a destination, finds the move or recovery dialog it left running when it mounts again.
 */
export type WorkspaceMoveControllers = Map<string, WorkspaceMoveController>

// The session's controller, shared with every other menu and the recovery dialog, for as long as this menu lives.
function useWorkspaceMoveController(
  controllers: WorkspaceMoveControllers,
  session: Pick<MountedSession, "key" | "id" | "server">,
  projectID: string,
) {
  const key = session.key
  const current = controllers.get(key)

  const move =
    current && untrack(current.state).status !== "disposed"
      ? current
      : createWorkspaceMoveController(session.server, session.id, projectID, () => {
          if (controllers.get(key) === move) controllers.delete(key)
        })

  controllers.set(key, move)
  move.dispatch({ type: "mounted" })
  onCleanup(() => move.dispatch({ type: "unmounted" }))

  return move
}

// Moves one session to an existing or a new worktree. A new worktree that does not receive the session (a failed or
// timed-out move, or a session that started running meanwhile) opens a dialog that retries the move or deletes the
// worktree. It ends once no menu is mounted and nothing runs or shows, or with the plugin.
function createWorkspaceMoveController(
  server: ServerRef,
  sessionID: string,
  projectID: string,
  release: () => void,
): WorkspaceMoveController {
  const ctx = usePlugin()
  const [moveState, setMoveState] = createSignal(createWorkspaceMoveState(projectID))
  const ops = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  const lists = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  const dialogs = new Map<number, DialogHandle>()
  // Events an effect raises synchronously (a dialog that closes and reports it) wait behind the current one.
  const queue: WorkspaceMoveEvent[] = []
  const dispose = () => dispatch({ type: "disposed" })

  const dispatch = (event: WorkspaceMoveEvent) => {
    queue.push(event)

    if (queue.length === 1) drain()
  }

  const drain = () => {
    const event = queue[0]

    if (!event) return

    try {
      const previous = untrack(moveState)
      const next = transitionWorkspaceMove(previous, event)

      if (next.state !== previous) setMoveState(next.state)

      if (next.state.status === "disposed" && previous.status !== "disposed") {
        ctx.signal.removeEventListener("abort", dispose)
        stop()
        release()
      }

      // One effect that throws must not skip the others.
      next.effects.forEach(
        (effect) =>
          void Promise.try(() => run(effect)).catch((cause: unknown) => console.error("[details] workspace move", cause)),
      )
    } finally {
      queue.shift()
      drain()
    }
  }

  const move: WorkspaceMoveController = {
    state: moveState,
    dispatch,
    dismiss: (attempt) => {
      const handle = dialogs.get(attempt)
      dialogs.delete(attempt)
      handle?.close()
      dispatch({ type: "dialog.dismissed", attempt })
    },
  }

  const failed = (cause: unknown) =>
    cause instanceof Error && cause.message ? cause.message : ctx.t("common.requestFailed")

  const start = (
    handles: typeof ops,
    attempt: number,
    timeoutMs: number,
    timedOut: WorkspaceMoveEvent,
  ): AbortSignal => {
    const controller = new AbortController()
    handles.set(attempt, { controller, timer: setTimeout(() => dispatch(timedOut), timeoutMs) })

    return AbortSignal.any([ctx.signal, controller.signal])
  }

  const end = (handles: typeof ops, attempt: number) => {
    const handle = handles.get(attempt)
    handles.delete(attempt)
    clearTimeout(handle?.timer)
    handle?.controller.abort()
  }

  const run = (effect: WorkspaceMoveEffect) => {
    if (effect.type === "list-worktrees") {
      const attempt = effect.attempt
      const signal = start(lists, attempt, effect.timeoutMs, { type: "list.failed", attempt })

      return void server.client.worktree.list({ projectID: effect.projectID }, { signal }).then(
        (items) => dispatch({ type: "list.loaded", attempt, items }),
        () => dispatch({ type: "list.failed", attempt }),
      )
    }

    if (effect.type === "abort-list") return end(lists, effect.attempt)

    if (effect.type === "refresh-worktrees")
      return void server.client.worktree
        .refresh({ projectID: effect.projectID }, { signal: ctx.signal })
        .catch(() => undefined)

    if (effect.type === "run-create") {
      const attempt = effect.attempt
      const signal = start(ops, attempt, effect.timeoutMs, { type: "op.timed-out", attempt })

      return void create(effect, signal).then(dispatch, (cause: unknown) =>
        dispatch({ type: "create.failed", attempt, error: failed(cause) }),
      )
    }

    if (effect.type === "run-move") {
      const attempt = effect.attempt
      const signal = start(ops, attempt, effect.timeoutMs, { type: "op.timed-out", attempt })

      return void moveTo(effect, signal).then(dispatch, (cause: unknown) =>
        dispatch({ type: "move.failed", attempt, error: failed(cause) }),
      )
    }

    if (effect.type === "run-remove") {
      const attempt = effect.attempt
      const signal = start(ops, attempt, effect.timeoutMs, { type: "op.timed-out", attempt })

      // Forced: the project's start command may have left untracked files in the new checkout.
      return void server.client.worktree
        .remove({ projectID: effect.projectID, directory: effect.directory, force: true }, { signal })
        .then(
          () => dispatch({ type: "remove.succeeded", attempt }),
          (cause: unknown) => dispatch({ type: "remove.failed", attempt, error: failed(cause) }),
        )
    }

    if (effect.type === "abort-op") return end(ops, effect.attempt)

    if (effect.type === "open-dialog")
      return void dialogs.set(
        effect.attempt,
        ctx.dialogs.open(() => (
          <WorkspaceMoveDialog move={move} attempt={effect.attempt} server={server} sessionID={sessionID} />
        )),
      )

    if (effect.type === "close-dialog") {
      const handle = dialogs.get(effect.attempt)
      dialogs.delete(effect.attempt)

      return handle?.close()
    }

    ctx.toast.show({
      variant: "error",
      title: ctx.t(effect.kind === "move" ? "move.failed" : "move.removeFailed"),
      description: reasonText(ctx.t, effect.reason),
    })
  }

  const create = async (
    effect: Extract<WorkspaceMoveEffect, { type: "run-create" }>,
    signal: AbortSignal,
  ): Promise<WorkspaceMoveEvent> => {
    const directory = effect.sourceDirectory

    const project =
      server.data.location.info({ directory })?.project ??
      (await server.client.location.get({ location: { directory } }, { signal })).project

    const created = await server.client.worktree.create({ projectID: project.id, from: project.canonical }, { signal })

    return {
      type: "worktree.created",
      attempt: effect.attempt,
      projectID: project.id,
      directory: created.directory,
      running: server.data.session.status(sessionID) === "running",
    }
  }

  const moveTo = async (
    effect: Extract<WorkspaceMoveEffect, { type: "run-move" }>,
    signal: AbortSignal,
  ): Promise<WorkspaceMoveEvent> => {
    // Populate the client cache before the destination session mounts.
    if (effect.syncLocation) await server.data.location.syncInfo({ directory: effect.directory })
    signal.throwIfAborted()

    // The session may have started running since the user picked the destination.
    if (server.data.session.status(sessionID) === "running") return { type: "move.blocked", attempt: effect.attempt }

    await server.client.session.move({ sessionID, directory: effect.directory }, { signal })

    return { type: "move.succeeded", attempt: effect.attempt }
  }

  // What the controller follows while it lives, with or without a menu: the server's worktree inventory and the
  // session's directory. The root ends with the controller.
  const stop = createRoot((disposeRoot) => {
    createKeyed(
      () => server.data,
      (data) =>
        onCleanup(
          data.on("worktree.updated", (event) => dispatch({ type: "worktree.updated", projectID: event.data.projectID })),
        ),
    )
    createKeyed(
      () => server.data.session.get(sessionID)?.location.directory,
      (directory) => dispatch({ type: "session.moved", directory }),
    )

    return disposeRoot
  })

  // The plugin's end ends the move, the list and the dialog that outlived the menu.
  ctx.signal.addEventListener("abort", dispose, { once: true })

  return move
}

// The recovery dialog for a worktree this controller created that does not have the session. Its controller outlives
// the menu that started the move.
function WorkspaceMoveDialog(props: {
  move: WorkspaceMoveController
  attempt: number
  server: ServerRef
  sessionID: string
}) {
  const ctx = usePlugin()
  const running = () => props.server.data.session.status(props.sessionID) === "running"

  // Keeps the last content while the dialog plays its exit animation after the controller closed it.
  const view = createMemo<WorkspaceDialogView | undefined>(
    (previous) => workspaceDialogView(props.move.state(), props.attempt, running()) ?? previous,
  )

  onCleanup(() => props.move.dismiss(props.attempt))

  return (
    <Show when={view()}>
      {(current) => {
        const error = () => {
          const reason = current().reason

          return reason.type === "failed" ? reason.error : undefined
        }

        // Focus starts on Retry, or on Keep worktree while Retry waits for the run, never on Delete worktree.
        const actions = () => (
          <>
            <Button variant="ghost" autofocus={current().running} onClick={() => props.move.dismiss(props.attempt)}>
              {ctx.t("move.recovery.keep")}
            </Button>
            <Button
              variant="ghost-danger"
              disabled={current().removeDisabled}
              onClick={() => props.move.dispatch({ type: "recovery.remove", attempt: props.attempt })}
            >
              <Show when={current().removing}>
                <Loader class="size-4 shrink-0" />
              </Show>
              {ctx.t("move.recovery.remove")}
            </Button>
            <Button
              variant="contrast"
              autofocus={!current().running}
              disabled={current().retryDisabled}
              onClick={() =>
                props.move.dispatch({ type: "recovery.retry", attempt: props.attempt, running: running() })
              }
            >
              <Show when={current().retrying}>
                <Loader class="size-4 shrink-0" />
              </Show>
              {ctx.t("retry")}
            </Button>
          </>
        )

        return (
          <Dialog fit>
            <DialogHeader>
              <DialogTitleGroup
                title={ctx.t("move.recovery.title")}
                description={
                  <>
                    {ctx.t("move.recovery.description", { name: getFilename(current().directory) })}
                    <Show when={!error()}> {reasonText(ctx.t, current().reason)}</Show>
                  </>
                }
              />
            </DialogHeader>
            <Show when={error()} fallback={<DialogFooter>{actions()}</DialogFooter>}>
              {(message) => (
                <DialogBody>
                  <ErrorDetails error={message()}>{actions()}</ErrorDetails>
                </DialogBody>
              )}
            </Show>
          </Dialog>
        )
      }}
    </Show>
  )
}

function reasonText(t: ReturnType<typeof usePlugin>["t"], reason: WorkspaceMoveFailure) {
  if (reason.type === "failed") return reason.error

  return t(reason.type === "running" ? "move.running" : "timedOut")
}
