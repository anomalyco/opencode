import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { BasicTool } from "./basic-tool"

export default {
  title: "OpenCode/Tools/Disclosure",
  id: "components-basic-tool",
  component: BasicTool,
  parameters: {
    docs: {
      description: {
        component:
          "The disclosure frame shared by production tool messages. Use these stories to inspect common resting, running, expanded, and summary-only states.",
      },
    },
  },
}

export const Completed = {
  render: () => (
    <BasicTool
      icon="glasses"
      defaultOpen
      trigger={{ title: "Read", subtitle: "src/session.ts", args: ["offset=1", "limit=80"] }}
    >
      <div class="px-3 py-2 text-12-regular text-text-base">Loaded the requested file.</div>
    </BasicTool>
  ),
}

export const Running = {
  render: () => (
    <BasicTool icon="console" status="running" trigger={{ title: "Running tests", subtitle: "bun test src/timeline" }}>
      <div class="px-3 py-2 font-mono text-12-regular text-text-base">Running timeline tests...</div>
    </BasicTool>
  ),
}

export const Collapsed = {
  render: () => (
    <BasicTool
      icon="magnifying-glass-menu"
      trigger={{ title: "Searched", subtitle: "packages/session-ui", args: ["pattern=TimelineRow.key"] }}
    >
      <div class="px-3 py-2 text-12-regular text-text-base">2 matching files</div>
    </BasicTool>
  ),
}

export const SummaryOnly = {
  render: () => (
    <BasicTool icon="post-skill" hideDetails trigger={{ title: "Skill", subtitle: "rtl-aware-development" }} />
  ),
}

export const Controlled = {
  render: () => {
    const [state, setState] = createStore({ open: false })
    return (
      <div class="flex max-w-[620px] flex-col gap-3">
        <Button class="w-fit" size="small" variant="neutral" onClick={() => setState("open", (value) => !value)}>
          {state.open ? "Close tool details" : "Open tool details"}
        </Button>
        <BasicTool
          icon="code-lines"
          open={state.open}
          onOpenChange={(open) => setState("open", open)}
          trigger={{ title: "Edited", subtitle: "src/session.ts", args: ["+3", "-1"] }}
        >
          <div class="px-3 py-2 text-12-regular text-text-base">Changed the active Session label.</div>
        </BasicTool>
      </div>
    )
  },
}
