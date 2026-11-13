import { BackgroundMoveHint } from "./message-timeline"

export default {
  title: "OpenCode/Session/Background work",
  id: "session-background-work",
  args: { keybind: "Ctrl+B" },
  parameters: {
    docs: {
      description: {
        component: "Production controls for moving blocking work and inspecting active background tasks.",
      },
    },
  },
}

export const InlineMoveHint = {
  render: (args: { keybind: string }) => (
    <div class="flex w-[696px] max-w-full flex-col items-start gap-4">
      <BackgroundMoveHint
        keybind={args.keybind
          .split("+")
          .map((key) => key.trim())
          .filter(Boolean)}
      />
    </div>
  ),
}
