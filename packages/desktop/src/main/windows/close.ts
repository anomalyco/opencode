import type { DesktopCloseChoice } from "@opencode/app/desktop-close"
import { Schema } from "effect"
import electron from "electron"
import type { BrowserWindow } from "electron"
import { refreshTrayMenu } from "../native/tray-menu"
import { nativeT } from "../native/translations"
import { CLOSE_ACTION_KEY } from "../storage/keys"
import { getStore } from "../storage/store"

export type CloseAction = "hide" | "quit"

export type CloseChoice = DesktopCloseChoice

type State = { readonly status: "idle" } | { readonly status: "asking" }

type Event = { readonly type: "request" } | { readonly type: "resolved" }

type DialogOutcome = {
  readonly action: CloseAction | undefined
  readonly remember: boolean
}

const idle: State = { status: "idle" }

const asking: State = { status: "asking" }

// The cancel button is last so a remembered choice is only saved for an explicit Hide or Quit.
const cancelId = 2

/** Closing the last window is intercepted only when the tray can keep the app reachable. */
export function needsTrayCloseDecision(input: {
  /** The tray keeps the app reachable while every window is hidden. */
  readonly tray: boolean
  /** A quit is under way; Electron cancels it when a window refuses to close. */
  readonly quitting: boolean
  /** App windows still open beside the one closing. */
  readonly openWindows: number
}) {
  return input.tray && !input.quitting && input.openWindows === 0
}

export function closeChoiceFromStored(value: Schema.Json | undefined): CloseChoice {
  return value === "ask" || value === "hide" || value === "quit" ? value : "quit"
}

export function readCloseChoice() {
  return closeChoiceFromStored(getStore().get(CLOSE_ACTION_KEY))
}

/**
 * No stored choice means the app closes as it always did. A tray only appears after someone chooses Ask or Hide,
 * so closing stays dormant until the user opts in from Settings or the close dialog.
 */
export function setCloseChoice(choice: DesktopCloseChoice) {
  getStore().set(CLOSE_ACTION_KEY, choice)
}

/** One prompt at a time; a second click on the close button cannot open another dialog. */
export function transition(state: State, event: Event) {
  if (event.type === "request" && state.status === "idle") return asking

  if (event.type === "resolved" && state.status === "asking") return idle

  return state
}

export function readDialogOutcome(response: number, checkboxChecked: boolean): DialogOutcome {
  if (response === cancelId) return { action: undefined, remember: false }

  return { action: response === 1 ? "quit" : "hide", remember: checkboxChecked }
}

export function closeDialogOptions() {
  return {
    // Windows plays its notification sound for icon-bearing message boxes; "none" keeps the prompt silent.
    type: "none" as const,
    title: nativeT("desktop.close.title"),
    message: nativeT("desktop.close.message"),
    buttons: [
      nativeT("desktop.close.hide"),
      nativeT("desktop.close.quit"),
      nativeT("desktop.close.cancel"),
    ],
    defaultId: 0,
    cancelId,
    checkboxLabel: nativeT("desktop.close.remember"),
    checkboxChecked: false,
    noLink: true,
  }
}

export function createClosePrompt(input: {
  readonly quit: () => void
  readonly isQuitting: () => boolean
}) {
  let state = idle

  const finish = () => {
    state = transition(state, { type: "resolved" })
  }

  const apply = (win: BrowserWindow, action: CloseAction) => {
    if (action === "quit") {
      input.quit()

      return
    }

    win.hide()
    refreshTrayMenu()
  }

  return {
    request(win: BrowserWindow) {
      if (win.isDestroyed()) return

      if (transition(state, { type: "request" }) === state) return
      state = asking

      const choice = readCloseChoice()

      if (choice !== "ask") {
        finish()

        apply(win, choice)

        return
      }

      void electron.dialog
        .showMessageBox(win, closeDialogOptions())
        .then(
          ({ response, checkboxChecked }) => {
            finish()

            if (win.isDestroyed() || input.isQuitting()) return

            const outcome = readDialogOutcome(response, checkboxChecked)

            if (!outcome.action) return

            if (outcome.remember) setCloseChoice(outcome.action)
            apply(win, outcome.action)
          },
          () => finish(),
        )
    },
  }
}
