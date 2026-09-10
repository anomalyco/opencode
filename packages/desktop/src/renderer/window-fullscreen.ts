import { createSignal } from "solid-js"

const [windowFullscreen, setWindowFullscreen] = createSignal(false)

window.api.onWindowFullscreenChanged(setWindowFullscreen)
void window.api.getWindowFullscreen().then(setWindowFullscreen)

export { windowFullscreen }
