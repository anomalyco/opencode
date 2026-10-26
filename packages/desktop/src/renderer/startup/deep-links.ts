import type { ElectronAPI } from "../api-types"

export type DeepLink =
  | { type: "new-session"; directory: string; prompt?: string }
  | { type: "open-session"; sessionID: string }

const pending: DeepLink[] = []

let open: ((link: DeepLink) => void) | undefined

export function startDeepLinks(api: ElectronAPI) {
  void api.consumeInitialDeepLinks().then(receive)
  api.onDeepLink(receive)
}

// Links can arrive before the app can open them, such as the one that launched it; they wait here until it binds.
export function bindDeepLinks(next: ((link: DeepLink) => void) | undefined) {
  open = next

  if (next) pending.splice(0).forEach(next)
}

function receive(urls: string[]) {
  urls.flatMap((url) => parseDeepLink(url) ?? []).forEach((link) => (open ? open(link) : pending.push(link)))
}

// `opencode://new-session?directory=<path>&prompt=<text>` and `opencode://open-session?id=<session id>`.
export function parseDeepLink(input: string): DeepLink | undefined {
  if (!URL.canParse(input)) return
  const url = new URL(input)

  if (url.protocol !== "opencode:") return

  if (url.hostname === "new-session") {
    const directory = url.searchParams.get("directory")

    if (!directory) return

    return { type: "new-session", directory, prompt: url.searchParams.get("prompt") || undefined }
  }

  if (url.hostname === "open-session") {
    const sessionID = url.searchParams.get("id")

    if (!sessionID) return

    return { type: "open-session", sessionID }
  }
}
