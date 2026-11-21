// A Windows toast whose body and buttons open `opencode://toast/<token>` links. Windows runs the app with the link
// (the running app gets it through `second-instance`), so a button works without a COM activator registered at
// install. The token is random per toast and lives only in the app that posted it, so a link from anywhere else
// answers nothing.

export type ToastInput = {
  readonly title: string
  readonly body: string
  readonly actions: ReadonlyArray<{ readonly id: string; readonly label: string }>
}

// Windows shows at most five buttons and three lines of text, the title included.
const MAX_ACTIONS = 5

const MAX_LINES = 2

export function toastXml(token: string, input: ToastInput) {
  const lines = input.body
    .split("\n")
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((line) => `<text>${escape(line)}</text>`)
    .join("")

  const actions = input.actions
    .slice(0, MAX_ACTIONS)
    .map(
      (action) =>
        `<action content="${escape(action.label)}" activationType="protocol" arguments="${escape(toastLink(token, action.id))}"/>`,
    )
    .join("")

  return [
    `<toast activationType="protocol" launch="${escape(toastLink(token))}">`,
    `<visual><binding template="ToastGeneric"><text>${escape(input.title)}</text>${lines}</binding></visual>`,
    actions ? `<actions>${actions}</actions>` : "",
    `<audio silent="true"/></toast>`,
  ].join("")
}

/** The token and button a toast link names, or undefined when the URL is not a toast's. */
export function parseToastLink(value: string) {
  if (!URL.canParse(value)) return
  const url = new URL(value)

  if (url.protocol !== "opencode:" || url.hostname !== "toast") return
  const token = url.pathname.slice(1)

  if (!/^[0-9a-f-]{36}$/.test(token)) return

  return { token, action: url.searchParams.get("action") ?? undefined }
}

function toastLink(token: string, action?: string) {
  const link = `opencode://toast/${token}`

  return action ? `${link}?action=${encodeURIComponent(action)}` : link
}

function escape(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
