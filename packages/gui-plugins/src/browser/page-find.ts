import type { WebContents } from "electron"
import type { FindAction, FindView } from "./ipc"
import { findView, initialFind, transitionFind } from "./find-machine"

/** One search session per native tab. Only the window receives its query and result. */
export function createPageFind(contents: WebContents, report: (view: FindView | null) => void, focus: () => void) {
  let state = initialFind
  let timer: ReturnType<typeof setTimeout> | undefined

  const search = (forward: boolean, fresh: boolean) => {
    if (!state.query) return
    const id = contents.findInPage(state.query, { forward, findNext: fresh })
    state = transitionFind(state, { type: "issued", id })
  }

  const found = (_event: Electron.Event, result: Electron.Result) => {
    const next = transitionFind(state, { type: "found", result })

    if (next === state) return
    state = next
    report(findView(state))
  }

  const close = () => {
    clearTimeout(timer)

    if (!findView(state)) return
    state = transitionFind(state, { type: "close" })
    contents.stopFindInPage("clearSelection")
    report(null)
  }

  contents.on("found-in-page", found)
  contents.on("did-navigate", close)

  return {
    run(action: FindAction) {
      if (action.type === "close") {
        close()
        focus()

        return
      }

      const previous = state

      if (state.status === "closed" && (action.type === "previous" || action.type === "next")) {
        state = transitionFind(state, { type: "open" })
        report(findView(state))
      }

      state = transitionFind(state, action)
      const view = findView(state)

      if (!view) return
      clearTimeout(timer)

      if (action.type === "previous" || action.type === "next")
        return search(action.type === "next", previous.status === "editing" || previous.status === "closed")
      report(view)

      if (!state.query) return contents.stopFindInPage("clearSelection")
      timer = setTimeout(() => search(true, true), 120)
    },
    dispose() {
      clearTimeout(timer)
      contents.off("found-in-page", found)
      contents.off("did-navigate", close)
    },
  }
}
