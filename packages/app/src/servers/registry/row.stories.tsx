import { For } from "solid-js"
import { ServerHealthIndicator } from "./row"
import type { ServerHealth } from "@/runtime/server/health-machine"

const states: { label: string; health?: ServerHealth }[] = [
  { label: "Waiting for sign-in", health: { type: "auth" } },
  { label: "Rejected our credentials", health: { type: "unauthorized" } },
  { label: "Connecting", health: { type: "starting" } },
  { label: "Tunnel ready, checking its new endpoint", health: { type: "checking", managed: true } },
  { label: "Checking", health: { type: "checking", managed: false } },
  { label: "Connected", health: { type: "healthy" } },
  { label: "Failed", health: { type: "unreachable" } },
  { label: "Incompatible", health: { type: "incompatible" } },
  { label: "Stopped", health: { type: "stopped" } },
  { label: "Not checked" },
]

export default { title: "App/Servers/Health indicator", id: "app-server-health" }

export const States = {
  render: () => (
    <div class="flex flex-col gap-4">
      <For each={states}>
        {(state) => (
          <div class="flex items-center gap-2">
            <div class="flex size-4 shrink-0 items-center justify-center">
              <ServerHealthIndicator health={state.health} />
            </div>
            <span>{state.label}</span>
          </div>
        )}
      </For>
    </div>
  ),
}
