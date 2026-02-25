import { postToSandbox } from "./sandbox"

export function enableInspect(iframe: HTMLIFrameElement) {
  postToSandbox(iframe, { type: "inspect", enabled: true })
}

export function disableInspect(iframe: HTMLIFrameElement) {
  postToSandbox(iframe, { type: "inspect", enabled: false })
}
