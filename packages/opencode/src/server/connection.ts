let connected = false

export function setConnected(value: boolean) {
  connected = value
}

export function isConnected() {
  return connected
}

function vscodePort() {
  return process.env.OPENCODE_VSCODE_IPC_PORT
}

function vscodeToken() {
  return process.env.OPENCODE_VSCODE_IPC_TOKEN
}

function ipcHeaders() {
  const token = vscodeToken()
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-opencode-token": token } : {}),
  }
}

export function forwardDiff(requestID: string, filepath: string, oldText: string, newText: string) {
  const port = vscodePort()
  if (!port) return
  fetch(`http://localhost:${port}/diff`, {
    method: "POST",
    headers: ipcHeaders(),
    body: JSON.stringify({ requestID, filepath, oldText, newText }),
  }).catch((e) => console.error("Failed to forward diff to VS Code:", e))
}

export function forwardReply(requestID: string) {
  const port = vscodePort()
  if (!port) return
  fetch(`http://localhost:${port}/reply`, {
    method: "POST",
    headers: ipcHeaders(),
    body: JSON.stringify({ requestID }),
  }).catch((e) => console.error("Failed to forward reply to VS Code:", e))
}

export function fetchEditedContent(requestID: string): Promise<string | undefined> {
  const port = vscodePort()
  if (!port) return Promise.resolve(undefined)
  const token = vscodeToken()
  return fetch(`http://localhost:${port}/diff-content/${requestID}`, {
    headers: token ? { "x-opencode-token": token } : undefined,
  })
    .then((res) => (res.ok ? res.json() : undefined))
    .then((data) => (typeof data?.content === "string" ? data.content : undefined))
    .catch(() => undefined)
}

export function register(serverURL: URL): Promise<boolean> {
  const port = vscodePort()
  if (!port) return Promise.resolve(false)
  return fetch(`http://localhost:${port}/register`, {
    method: "POST",
    headers: ipcHeaders(),
    body: JSON.stringify({ port: serverURL.port }),
  })
    .then((res) => res.ok)
    .catch((e) => {
      console.error("Failed to register with VS Code:", e)
      return false
    })
}