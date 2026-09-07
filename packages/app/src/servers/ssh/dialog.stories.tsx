import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { onCleanup, onMount } from "solid-js"
import { PlatformProvider } from "@/runtime/platform/platform"
import { SshServersProvider } from "./context"
import { DialogSsh } from "./dialog"
import type { SshItem, SshPlatform, SshState } from "./types"

function Fixture(props: { initial?: "connecting" | "password" | "confirmation" | "failure"; responseDelay?: number }) {
  const state: { item?: SshItem; step: number; timer?: ReturnType<typeof setTimeout> } = { step: 0 }
  onCleanup(() => clearTimeout(state.timer))
  const listeners = new Set<(state: SshState) => void>()
  const snapshot = (): SshState => ({ servers: state.item ? [state.item] : [] })
  const update = (changes: Partial<SshItem>) => {
    if (!state.item) return
    state.item = { ...state.item, ...changes }
    listeners.forEach((listener) => listener(snapshot()))
  }
  const prompts = [
    {
      id: "host-key",
      text: "The authenticity of host 'dev.example.com' can't be established.\nED25519 key fingerprint is SHA256:EXAMPLE-FINGERPRINT-FOR-STORY-ONLY.\nAre you sure you want to continue connecting?",
      confirm: true,
    },
    { id: "password", text: "brendon@dev.example.com's password:", confirm: false },
    { id: "otp", text: "Verification code:", confirm: false },
  ]
  const api: SshPlatform = {
    getState: async () => snapshot(),
    subscribe(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    hosts: async () => ["devbox", "staging", "build-host"],
    start: async (input) => {
      clearTimeout(state.timer)
      state.step = props.initial === "password" ? 1 : 0
      state.item = {
        config: input,
        saved: false,
        stage: "connecting",
        detail: "",
        destination: "brendon@dev.example.com:22",
      }
      if (props.initial === "connecting") return
      update(
        props.initial === "failure"
          ? {
              stage: "failed",
              error: "connection",
              detail: "ssh: connect to host dev.example.com port 22: Connection refused",
            }
          : { stage: "authentication", prompt: prompts[state.step] },
      )
    },
    respond: async () => {
      const next = () => {
        state.step += 1
        update(
          state.step < prompts.length
            ? { stage: "authentication", prompt: prompts[state.step] }
            : { stage: "ready", prompt: undefined },
        )
      }
      if (!props.responseDelay) return next()
      update({ stage: "connecting", prompt: undefined })
      state.timer = setTimeout(next, props.responseDelay)
    },
    resolve: async () => null,
    disconnect: async () => {
      clearTimeout(state.timer)
      update({ stage: "disconnected", prompt: undefined })
    },
    forget: async () => {
      state.item = undefined
      listeners.forEach((listener) => listener(snapshot()))
    },
    openConfig: async () => {},
  }
  return (
    <PlatformProvider
      value={{
        platform: "desktop",
        windowID: "ssh-story",
        sshServers: api,
        openExternal() {},
        restart: async () => {},
        notify: async () => {},
        openDirectoryPickerDialog: async () => null,
      }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <SshServersProvider>
          <Open initial={props.initial} />
        </SshServersProvider>
      </QueryClientProvider>
    </PlatformProvider>
  )
}

function Open(props: { initial?: string }) {
  const dialog = useDialog()
  const open = () =>
    dialog.show(() => (
      <DialogSsh
        config={props.initial ? { id: "story", target: "devbox", name: "Development" } : undefined}
        connect={!!props.initial}
      />
    ))
  onMount(open)
  return <Button onClick={open}>Open SSH connection</Button>
}

export default { title: "App/Dialogs/SSH", id: "app-dialog-ssh" }
export const Host = { render: () => <Fixture /> }
export const Connecting = { render: () => <Fixture initial="connecting" /> }
export const Password = { render: () => <Fixture initial="password" /> }
export const SlowPassword = { render: () => <Fixture initial="password" responseDelay={5000} /> }
export const Confirmation = { render: () => <Fixture initial="confirmation" /> }
export const Failure = { render: () => <Fixture initial="failure" /> }
