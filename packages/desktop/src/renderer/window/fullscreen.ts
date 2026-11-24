import { createSignal } from "solid-js"
import { api } from "../api"
import {
  createFullscreenState,
  selectWindowFullscreen,
  transitionFullscreen,
  type FullscreenEvent,
} from "./fullscreen-machine"

let state = createFullscreenState()

const [windowFullscreen, setWindowFullscreen] = createSignal(selectWindowFullscreen(state))

const dispatch = (event: FullscreenEvent) => {
  const next = transitionFullscreen(state, event)

  if (next === state) return
  state = next
  setWindowFullscreen(selectWindowFullscreen(state))
}

api.onWindowFullscreenChanged((fullscreen) => dispatch({ type: "fullscreen.changed", fullscreen }))

void api.getWindowFullscreen().then(
  (fullscreen) => dispatch({ type: "fullscreen.seeded", fullscreen }),
  () => dispatch({ type: "fullscreen.seed-failed" }),
)

export { windowFullscreen }
