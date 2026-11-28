import { Button } from "@opencode/ui/button"
import { createSignal, Show } from "solid-js"
import { DialogLabRuntime, LAB_LOCKED_SERVER, LAB_SERVER } from "@/lab/dialog-runtime"
import { ServerProvider } from "@/runtime/server/current"
import type { ServerConnection } from "@/runtime/server/registry"
import { ServerSignedOutPanel, ServerUnavailablePanel } from "./server-unavailable-panel"

const reasons = ["unreachable", "incompatible", "signedOutHttp", "signedOutPlugin", "signedOutManaged"] as const

type Args = { reason: (typeof reasons)[number]; closable: boolean }

function PanelLab(props: Args) {
  const [outcome, setOutcome] = createSignal("")

  const plugin: ServerConnection.Plugin = {
    type: "plugin",
    key: "lab:studio",
    plugin: "lab",
    displayName: "Build workstation",
    managed: true,
    status: { type: props.reason === "incompatible" ? "incompatible" : "stopped" },
    authenticate: () => false,
    connect:
      props.reason === "signedOutManaged"
        ? undefined
        : async () => {
            setOutcome("Signed in to the build workstation")

            return true
          },
  }

  const reason = () => (props.reason === "incompatible" ? "incompatible" : "unreachable")

  return (
    <DialogLabRuntime servers={[LAB_SERVER, LAB_LOCKED_SERVER, plugin]}>
      <div class="flex h-[min(80dvh,640px)] w-full flex-col">
        <Show
          when={!outcome()}
          fallback={
            <div class="m-auto flex flex-col items-center gap-3">
              <output>{outcome()}</output>
              <Button size="small" onClick={() => setOutcome("")}>
                Reopen session
              </Button>
            </div>
          }
        >
          <Show
            when={props.reason === "unreachable" || props.reason === "incompatible"}
            fallback={<ServerSignedOutPanel conn={props.reason === "signedOutHttp" ? LAB_LOCKED_SERVER : plugin} />}
          >
            <ServerProvider conn={plugin}>
              <ServerUnavailablePanel
                reason={reason()}
                onClose={props.closable ? () => setOutcome("Session tab closed") : undefined}
              />
            </ServerProvider>
          </Show>
        </Show>
      </div>
    </DialogLabRuntime>
  )
}

export default {
  title: "OpenCode/Session/Server unavailable",
  id: "session-server-unavailable",
  args: { reason: "unreachable", closable: true } satisfies Args,
  argTypes: { reason: { options: reasons } },
  render: (args: Args) => (
    <Show when={args.reason} keyed>
      {(reason) => <PanelLab reason={reason} closable={args.closable} />}
    </Show>
  ),
}

export const Unreachable = {}

export const Incompatible = { args: { reason: "incompatible" } }

export const Draft = { args: { closable: false } }

export const SignedOut = { args: { reason: "signedOutHttp" } }

export const PluginSignIn = { args: { reason: "signedOutPlugin" } }

export const NoSignInAction = { args: { reason: "signedOutManaged" } }
