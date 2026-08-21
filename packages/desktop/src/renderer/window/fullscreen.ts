import { createSignal } from "solid-js"
import { api } from "../api"

const [windowFullscreen, setWindowFullscreen] = createSignal(false)

api.onWindowFullscreenChanged(setWindowFullscreen)
void api.getWindowFullscreen().then(setWindowFullscreen)

export { windowFullscreen }
