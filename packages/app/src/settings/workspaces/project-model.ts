import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import type { LocalProject } from "@/shell/state/layout"
import { ServerConnection } from "@/runtime/server/registry"
import { showToast } from "@/shell/notifications/toast"
import {
  createProjectSettingsState,
  PROJECT_SAVE_TIMEOUT_MS,
  selectProjectSettingsView,
  transitionProjectSettings,
  type ProjectField,
  type ProjectPatch,
  type ProjectSettingsEffect,
  type ProjectSettingsEvent,
  type ProjectTarget,
} from "./project-machine"

export function createEditProjectModel(props: { project: LocalProject; server: ServerConnection.Any }) {
  const language = useLanguage()
  const serverCtx = useServer().ctx

  const snapshot = () => ({
    id: props.project.id,
    worktree: props.project.worktree,
    name: props.project.name,
    color: props.project.icon?.color,
    iconOverride: props.project.icon?.override,
    startup: props.project.commands?.start,
  })

  const [settings, setSettings] = createSignal(createProjectSettingsState(untrack(snapshot)))
  const view = createMemo(() => selectProjectSettingsView(settings()))

  let iconInput: HTMLInputElement | undefined
  let reader: FileReader | undefined
  // The latest save sent. Every save and flush waits for it, so saves go out in order even when a flush for a project
  // the page left is still queued when the page comes back to it.
  let inflight: Promise<unknown> = Promise.resolve()

  const dispatch = (event: ProjectSettingsEvent) => {
    const next = transitionProjectSettings(untrack(settings), event)
    setSettings(next.state)
    next.effects.forEach(
      (effect) => void Promise.try(() => run(effect)).catch((cause: unknown) => console.error(cause)),
    )
  }

  const request = (target: ProjectTarget, patch: ProjectPatch, signal: AbortSignal) => {
    if (target.id && target.id !== "global") {
      const projectID = target.id

      return serverCtx.sdk.api.project
        .update({ projectID, ...patch }, { signal })
        .then((project) => serverCtx.sync.project.update(project))
    }

    return Promise.try(() => serverCtx.sync.project.meta(target.worktree, patch))
  }

  const run = (effect: ProjectSettingsEffect) => {
    if (effect.type === "run-save") {
      const controller = new AbortController()

      // The timer outlives the page on purpose: a save sent before it closed still finishes, or is cut off. It starts
      // now, so time spent waiting behind an earlier save counts against it too.
      const timer = setTimeout(() => {
        controller.abort()
        dispatch({
          type: "save.timed-out",
          saveAttempt: effect.saveAttempt,
          error: language.t("common.requestFailed"),
        })
      }, PROJECT_SAVE_TIMEOUT_MS)

      const send = () => request(effect.target, effect.patch, controller.signal)

      inflight = inflight
        .then(send, send)
        .then(
          () => dispatch({ type: "save.succeeded", saveAttempt: effect.saveAttempt }),
          (cause: unknown) =>
            dispatch({
              type: "save.failed",
              saveAttempt: effect.saveAttempt,
              error: cause instanceof Error ? cause.message : language.t("common.requestFailed"),
            }),
        )
        .finally(() => clearTimeout(timer))

      return
    }

    if (effect.type === "flush") {
      const send = () => request(effect.target, effect.patch, AbortSignal.timeout(PROJECT_SAVE_TIMEOUT_MS))
      inflight = inflight.then(send, send)

      return
    }

    if (effect.type === "read-icon") {
      reader?.abort()
      const current = new FileReader()
      reader = current
      current.onload = () => {
        const result = current.result

        if (!result || result instanceof ArrayBuffer)
          return dispatch({ type: "icon.file-failed", attempt: effect.attempt })
        dispatch({ type: "icon.file-loaded", attempt: effect.attempt, dataUrl: result })
      }

      current.onerror = () => dispatch({ type: "icon.file-failed", attempt: effect.attempt })
      current.readAsDataURL(effect.file)

      return
    }

    if (effect.type === "abort-icon-read") {
      reader?.abort()
      reader = undefined

      return
    }

    showToast({ variant: "error", title: language.t("common.requestFailed"), description: effect.error })
  }

  // The settings shell keeps this page mounted when it moves to another project on the same server.
  createEffect(
    on(
      () => [props.project.id, props.project.worktree],
      () => dispatch({ type: "project.synced", project: untrack(snapshot) }),
      { defer: true },
    ),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  const selectFile = (file: File) => dispatch({ type: "icon.file-selected", file })

  return {
    view,
    defaultName: () => props.project.name || view().folderName,
    editName: (value: string) => dispatch({ type: "name.edited", value }),
    saveName: () => dispatch({ type: "name.committed" }),
    editStartup: (value: string) => dispatch({ type: "startup.edited", value }),
    saveStartup: () => dispatch({ type: "startup.committed" }),
    retry: (field: ProjectField) => dispatch({ type: "field.retried", field }),
    setColor: (color: string | undefined) => dispatch({ type: "color.selected", color }),
    drop(event: DragEvent) {
      event.preventDefault()
      const file = event.dataTransfer?.files[0]

      if (file) return selectFile(file)
      dispatch({ type: "icon.drag-left" })
    },
    dragOver(event: DragEvent) {
      event.preventDefault()
      dispatch({ type: "icon.drag-over" })
    },
    dragLeave(event: DragEvent & { currentTarget: HTMLElement }) {
      // Moving between the button's own children is not leaving it.
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
      dispatch({ type: "icon.drag-left" })
    },
    inputChange(input: HTMLInputElement) {
      const file = input.files?.[0]
      // Cleared so choosing the same image again after removing it still fires a change.
      input.value = ""

      if (file) selectFile(file)
    },
    // Hover only reveals the remove overlay; a tap, click or Enter removes a custom icon on any input device.
    iconClick() {
      if (view().iconOverride) return dispatch({ type: "icon.cleared" })
      iconInput?.click()
    },
    setIconInput(input: HTMLInputElement) {
      iconInput = input
    },
  }
}
