import { DockShell, DockTray, type DockTrayProps } from "./dock-surface"

type Args = { attach: NonNullable<DockTrayProps["attach"]>; message: string }

export default {
  title: "UI/DockSurface",
  id: "ui-dock-surface",
  args: { attach: "top", message: "Workspace location is missing" } satisfies Args,
  argTypes: { attach: { options: ["none", "top"] } },
  render: (args: Args) => (
    <div class="w-full max-w-sm">
      <DockShell class="px-4 py-3 font-medium">{args.message}</DockShell>
      <DockTray
        attach={args.attach}
        class="px-4 pb-3"
        classList={{ "pt-6": args.attach === "top", "mt-2 pt-3": args.attach === "none" }}
      >
        Select a directory to continue the session.
      </DockTray>
    </div>
  ),
}

export const Attached = {}

export const Detached = { args: { attach: "none" } }
