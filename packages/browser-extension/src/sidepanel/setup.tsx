// Shown until the panel has an opencode server: discovery in progress, the native host is missing,
// or the server could not be reached. Uses the welcome tab's language and re-checks on its own.
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Logo } from "@opencode/ui/logo"
import { Spinner } from "@opencode/ui/spinner"
import { TextField } from "@opencode/ui/text-field"
import { Show, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import type { ServiceState } from "../shared/protocol"
import { CommandBlock, INSTALL_COMMAND, Waiting, createServiceWatch, sentence } from "./onboarding"
import type { Background } from "./port"

export function Loading(props: { label: string }) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-3 pb-8 text-v2-text-text-faint">
      <Spinner class="size-4 text-v2-text-text-muted" />
      <span class="text-12-regular">{props.label}</span>
    </div>
  )
}

export function Setup(props: { state: Exclude<ServiceState, { status: "ready" }>; background: Background }) {
  const [manual, setManual] = createSignal(false)
  const service = createServiceWatch({
    state: () => props.state,
    refresh: () => props.background.send({ type: "service.refresh" }),
  })
  const failure = () => {
    const state = service.state()
    return state.status === "error" ? state : undefined
  }
  return (
    <Show when={failure()} fallback={<Loading label="Connecting to opencode…" />}>
      {(error) => (
        <div class="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-10 pb-5">
          <Logo class="mb-7 block aspect-[234/42] w-[104px] self-start" />
          <h1 class="text-[15px] font-[530] leading-6 tracking-[-0.1px] text-v2-text-text-base">
            {error().hostMissing ? "Connect to opencode" : "Can't reach opencode"}
          </h1>
          <Show
            when={error().hostMissing}
            fallback={
              <p class="mt-1 text-[13px] leading-5 text-v2-text-text-muted">
                <span class="break-words">{sentence(error().message)}</span> Run the install command again to start
                opencode.
              </p>
            }
          >
            <p class="mt-1 text-[13px] leading-5 text-v2-text-text-muted">
              OpenCode Browser reaches opencode through a small helper. Run this once in a terminal. It installs the
              helper and starts opencode.
            </p>
          </Show>
          <CommandBlock command={INSTALL_COMMAND} class="mt-4" />
          <Waiting checking={service.checking()} onRetry={service.retry}>
            {error().hostMissing ? "Waiting for opencode…" : "Checking again every few seconds."}
          </Waiting>

          <div class="mt-6 border-t border-v2-border-border-muted pt-3">
            <Button
              variant="ghost-muted"
              size="small"
              class="-ms-2"
              aria-expanded={manual()}
              onClick={() => setManual((value) => !value)}
            >
              Enter a server manually
              <Icon name="chevron-down" size="small" classList={{ "rotate-180": manual() }} />
            </Button>
            <Show when={manual()}>
              <ManualServer background={props.background} />
            </Show>
          </div>
          <p class="mt-auto pt-8 text-12-regular text-v2-text-text-faint">
            Extension ID <span class="font-mono select-all">{chrome.runtime.id}</span>
          </p>
        </div>
      )}
    </Show>
  )
}

function ManualServer(props: { background: Background }) {
  const [form, setForm] = createStore({ url: "http://127.0.0.1:4096", password: "" })
  return (
    <form
      class="mt-2 flex flex-col gap-3 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        props.background.send({ type: "service.manual", url: form.url.trim(), password: form.password })
      }}
    >
      <TextField label="Server URL" value={form.url} onChange={(value) => setForm("url", value)} required />
      <TextField
        label="Password"
        type="password"
        value={form.password}
        onChange={(value) => setForm("password", value)}
        description="Find it with: opencode service get password"
      />
      <div class="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost-muted"
          size="small"
          onClick={() => props.background.send({ type: "service.clearManual" })}
        >
          Use automatic discovery
        </Button>
        <Button type="submit" variant="neutral" size="normal" disabled={!form.url.trim()}>
          Connect
        </Button>
      </div>
    </form>
  )
}
