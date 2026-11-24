import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { DockShell, DockTray } from "@opencode/ui/dock-surface"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { createEffect, createMemo, createSignal, createUniqueId, on, onCleanup, Show, untrack } from "solid-js"
import { useWorktreeDialog } from "@/new-session/location/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { createWorktree } from "@/workspaces/create"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import {
  createLocationMissingState,
  LOCATION_MOVE_SETTLE_TIMEOUT_MS,
  selectLocationMissingView,
  transitionLocationMissing,
  type LocationMissingEffect,
  type LocationMissingEvent,
} from "./location-missing-machine"
import "./location-missing.css"

export function SessionLocationMissing(props: { sessionID: string; projectID: string; directory: string }) {
  const language = useLanguage()
  const server = useServer()
  const data = useData()
  const dialog = useDialog()
  const pickDirectory = useDirectoryPicker()
  const project = () => data.project.get(props.projectID)

  const openWorktrees = useWorktreeDialog()
  const [machine, setMachine] = createSignal(createLocationMissingState())
  const view = createMemo(() => selectLocationMissingView(machine()))
  let timer: ReturnType<typeof setTimeout> | undefined
  let button: HTMLButtonElement | undefined

  const dispatch = (event: LocationMissingEvent) => {
    const next = transitionLocationMissing(untrack(machine), event)

    if (next.state !== untrack(machine)) setMachine(next.state)
    next.effects.forEach(run)
  }

  function run(effect: LocationMissingEffect) {
    if (effect.type === "picker.open")
      return pickDirectory({
        server: server.conn,
        title: language.t("session.location.choose"),
        onSelect: (result) =>
          dispatch({
            type: "picker.settled",
            attempt: effect.attempt,
            directory: (Array.isArray(result) ? result[0] : result) ?? undefined,
            dialogOpen: !!dialog.active,
          }),
      })

    if (effect.type === "move.run") {
      // Creating the worktree is not aborted on unmount: cutting it off kills the project's setup script midway.
      void moveSession(effect.directory).then(
        () => dispatch({ type: "move.succeeded", attempt: effect.attempt }),
        (error) => dispatch({ type: "move.failed", attempt: effect.attempt, error, dialogOpen: !!dialog.active }),
      )

      return
    }

    if (effect.type === "timer.start") {
      clearTimeout(timer)
      timer = setTimeout(
        () => dispatch({ type: "move.settle-timed-out", attempt: effect.attempt }),
        LOCATION_MOVE_SETTLE_TIMEOUT_MS,
      )

      return
    }

    if (effect.type === "timer.cancel") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "focus.choose") return button?.focus()

    showToast({
      variant: "error",
      title: language.t("session.location.moveFailed"),
      description: effect.error instanceof Error ? effect.error.message : language.t("common.requestFailed"),
    })
  }

  const moveSession = async (directory: string | undefined) => {
    // The missing worktree cannot resolve its own Location, so create from the project's saved checkout.
    const current = project()

    const destination =
      directory ??
      (current &&
        (await createWorktree({
          api: server.ctx.sdk.api,
          data,
          directory: current.canonical,
          project: { id: current.id, canonical: current.canonical, directory: current.canonical },
        })))

    // The project has not loaded yet, so there is no checkout to create the worktree from.
    if (!destination) throw new Error(language.t("common.requestFailed"))
    await server.ctx.sdk.api.session.move({ sessionID: props.sessionID, directory: destination })
    // Read the moved session now, so the notice gives way even when the server's event lags.
    await data.session.sync(props.sessionID).catch(() => undefined)
  }

  createEffect(
    on(
      () => !!dialog.active,
      (open) => dispatch({ type: "dialog.changed", open }),
      { defer: true },
    ),
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  const id = createUniqueId()

  const chooseWorktree = () => {
    const current = project()

    if (!current) return
    openWorktrees({
      project: { ...current, worktree: current.canonical, worktrees: server.ctx.sync.worktrees.cached(current.id) },
      omit: props.directory,
      onSelect: (value) =>
        dispatch({
          type: "move.worktree",
          directory: value === "create" ? undefined : value === "main" ? current.canonical : value,
        }),
    })
  }

  return (
    <div data-component="session-location-missing">
      <DockShell data-slot="location-body">
        <div
          role="group"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-path ${id}-description`}
          data-slot="location-status"
        >
          <Icon name="warning" />
          <div data-slot="location-details">
            <div id={`${id}-title`} role="status" data-slot="location-title">
              {language.t("session.location.unavailable")}
            </div>
            <div id={`${id}-path`} data-slot="location-path">
              {props.directory}
            </div>
            <div id={`${id}-description`} data-slot="location-description">
              {language.t("session.location.description")}
            </div>
          </div>
        </div>
      </DockShell>
      <DockTray data-slot="location-footer">
        <Show when={project()?.vcs === "git"}>
          <Button
            variant={view().pendingWorktree ? "loading" : "neutral"}
            size="large"
            onClick={chooseWorktree}
            disabled={view().disabled}
          >
            <Show when={view().pendingWorktree}>
              <Loader />
            </Show>
            {language.t(view().pendingWorktree ? "session.location.moving" : "session.location.worktree")}
          </Button>
        </Show>
        <Button
          ref={button}
          variant={view().pendingDirectory ? "loading" : "submit"}
          size="large"
          onClick={() => dispatch({ type: "choose.requested" })}
          disabled={view().disabled}
        >
          <Show when={view().pendingDirectory}>
            <Loader />
          </Show>
          {language.t(view().pendingDirectory ? "session.location.moving" : "session.location.choose")}
        </Button>
      </DockTray>
    </div>
  )
}
