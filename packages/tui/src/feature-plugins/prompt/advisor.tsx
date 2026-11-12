import { Plugin } from "@opencode/plugin/tui"
import { Advisor } from "@opencode/schema/advisor"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"

export default Plugin.define({
  id: "opencode.advisor",
  setup(context) {
    const [state, setState] = createSignal<Advisor.State>({ mode: "off" })
    const rpc = context.client.rpc(Advisor.Definition)
    const locationOption = () => (context.location ? { location: context.location } : undefined)
    // A server without the plugin (flag off) rejects `get`, and the TUI shows nothing.
    const load = () => void rpc.get({}, locationOption()).then(setState, () => undefined)
    load()

    const name = (model: { providerID: string; id: string }) => {
      const found = context.data.location.model
        .list(context.location)
        ?.find((item) => item.providerID === model.providerID && item.id === model.id)
      return found?.name ?? `${model.providerID}/${model.id}`
    }

    context.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const theme = useTheme()
        const label = createMemo(() => {
          const current = state()
          return current.mode === "off"
            ? undefined
            : `${current.mode === "secure" ? "Advisor (secure)" : "Advisor"}: ${name(current.model)}`
        })
        return (
          <Show when={label()}>
            {(value) => (
              <box flexShrink={0} onMouseUp={() => context.keymap.dispatch("advisor.pick")}>
                <text wrapMode="none">
                  <span style={{ fg: theme.text.feedback.info.base }}>⊙ </span>
                  <span style={{ fg: theme.text.muted }}>{value()} · </span>
                  <span style={{ fg: theme.text.muted }}>/advisor</span>
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
        onCleanup(context.data.on("server.connected", load))
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "advisor.pick",
              title: "Set advisor",
              description: "Choose a second model the session model can consult, and what it may see",
              group: "Agent",
              palette: true,
              slash: { name: "advisor", arguments: true },
              async run(input) {
                const set = (next: Advisor.State) =>
                  rpc.set(next, locationOption()).then(
                    (saved) =>
                      toast.show({
                        message:
                          saved.mode === "off"
                            ? "Advisor off"
                            : `${saved.mode === "secure" ? "Advisor (secure)" : "Advisor"}: ${name(saved.model)}`,
                        variant: "info",
                      }),
                    (error: unknown) => toast.error(error),
                  )
                if (input?.trim().toLowerCase() === "off") return set({ mode: "off" })
                const mode = await context.ui.dialog.select({
                  title: "Advisor",
                  current: state().mode,
                  options: [
                    { title: "Off", value: "off" as const },
                    {
                      title: "Advisor",
                      value: "full" as const,
                      description: "Sees the whole conversation. Uses more tokens.",
                    },
                    {
                      title: "Advisor (secure)",
                      value: "secure" as const,
                      description: "Sees only a brief the agent writes; the conversation is never sent.",
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
                const selected = state()
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
                return set({ mode, model })
              },
            },
          ],
        }))
        return null
      },
    })
  },
})
