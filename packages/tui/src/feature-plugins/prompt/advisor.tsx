import { Plugin } from "@opencode/plugin/tui"
import { Advisor } from "@opencode/schema/advisor"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"

export default Plugin.define({
  id: "opencode.advisor",
  setup(context) {
    // `null` while the `advisor` flag is off (or the server lacks the plugin): the command and indicator stay hidden.
    const [state, setState] = createSignal<Advisor.State | null>(null)
    const rpc = context.client.rpc(Advisor.Definition)
    const locationOption = () => (context.location ? { location: context.location } : undefined)
    const load = () =>
      rpc.get({}, locationOption()).then(
        (next) => setState(next),
        () => setState(null),
      )
    void load()

    // Only inside a session, and as short as the goal indicator: the home screen stays clean.
    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        const theme = useTheme()
        const [hovered, setHovered] = createSignal(false)
        // The setting is shared by every open Location, but `changed` only reaches this one, so re-read it when the
        // session changes.
        createEffect(
          on(
            () => input.sessionID,
            () => void load(),
            { defer: true },
          ),
        )
        const label = createMemo(() => {
          const current = state()
          if (!input.sessionID || !current || current.mode === "off") return undefined
          return current.mode === "secure" ? "advisor (secure)" : "advisor"
        })
        return (
          <Show when={label()}>
            {(value) => (
              <box
                flexShrink={0}
                onMouseOver={() => setHovered(true)}
                onMouseOut={() => setHovered(false)}
                onMouseUp={() => context.keymap.dispatch("advisor.pick")}
              >
                <text fg={hovered() ? theme.text.base : theme.text.muted} wrapMode="none">
                  ⊙ {value()}
                </text>
              </box>
            )}
          </Show>
        )
      },
    })

    context.ui.slot({
      append: "app",
      render() {
        const toast = useToast()
        onCleanup(
          rpc.events.on("changed", (event) => {
            setState(event.data)
          }),
        )
        onCleanup(context.data.on("server.connected", () => void load()))
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "advisor.pick",
              title: "Set advisor",
              description: "Choose a second model the session model can consult, and what it may see",
              group: "Agent",
              palette: true,
              slash: { name: "advisor" },
              enabled: () => state() !== null,
              async run() {
                // `label` names the picked model for the confirmation toast; without one the advisor was turned off.
                const set = (next: Advisor.State, label?: string) =>
                  rpc.set(next, locationOption()).then(
                    (saved) =>
                      toast.show(
                        saved === null
                          ? { message: "Turn on the experimental advisor flag first.", variant: "warning" }
                          : {
                              message: label
                                ? `${next.mode === "secure" ? "Advisor (secure)" : "Advisor"}: ${label}`
                                : "Advisor off",
                              variant: "info",
                            },
                      ),
                    (error: unknown) => toast.error(error),
                  )
                // Another Location may have changed it since this one last looked.
                await load()
                const selected = state()
                if (!selected) return
                const mode = await context.ui.dialog.select({
                  title: "Advisor",
                  current: selected.mode,
                  options: [
                    { title: "Off", value: "off" as const },
                    {
                      title: "Advisor",
                      value: "full" as const,
                      description: "Sees the conversation; uses more tokens",
                    },
                    {
                      title: "Advisor (secure)",
                      value: "secure" as const,
                      description: "Sees only the agent's brief",
                    },
                  ],
                })
                if (!mode) return
                if (mode === "off") return set({ mode: "off" })
                const providers = new Map(
                  (context.data.location.provider.list(context.location) ?? []).map((item) => [item.id, item]),
                )
                const models = (context.data.location.model.list(context.location) ?? []).filter(
                  (item) => item.status !== "deprecated" && (item.type ?? "chat") === "chat",
                )
                if (models.length === 0) {
                  toast.show({ message: "No models available. Connect a provider first.", variant: "warning" })
                  return
                }
                const model = await context.ui.dialog.select({
                  title: "Advisor model",
                  placeholder: "Search models",
                  current:
                    selected.mode === "off"
                      ? undefined
                      : { providerID: selected.model.providerID, id: selected.model.id },
                  options: models.map((item) => ({
                    title: item.name,
                    value: { providerID: item.providerID, id: item.id },
                    category: providers.get(item.providerID)?.name ?? item.providerID,
                  })),
                })
                if (!model) return
                return set(
                  { mode, model },
                  models.find((item) => item.providerID === model.providerID && item.id === model.id)?.name ??
                    `${model.providerID}/${model.id}`,
                )
              },
            },
          ],
        }))
        return null
      },
    })
  },
})
