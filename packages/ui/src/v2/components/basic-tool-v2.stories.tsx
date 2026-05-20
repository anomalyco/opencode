import { createSignal } from "solid-js"
import { BasicToolV2 } from "./basic-tool-v2"

const docs = `### Overview
Compact collapsible tool row showing title, subtitle, args, and diff changes, with an expand/collapse chevron.

### API
- \`BasicToolV2\` wraps Kobalte \`Collapsible\`. Pass \`open\`, \`defaultOpen\`, and \`onOpenChange\` for controlled/uncontrolled disclosure.
- \`trigger\` accepts either a \`BasicToolV2TriggerTitle\` object (title, subtitle, args, changes) or arbitrary JSX.
- When \`status\` is \`"pending"\` or \`"running"\`, subtitle/args/chevron hide and the title shows a shimmer animation.
- Pass \`children\` for expandable detail content.

### Theming
- Uses \`data-component="basic-tool-v2"\` and slot attributes; colors via \`--bt-*\` CSS variables.
`

export default {
  title: "UI V2/BasicTool",
  id: "components-basic-tool-v2",
  component: BasicToolV2,
  tags: ["autodocs"],
  parameters: {
    frameBackground: "#fff",
    layout: "padded",
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Default = {
  render: () => (
    <BasicToolV2
      trigger={{
        title: "Read",
        subtitle: "src/index.ts",
        args: ["lines=1-50"],
        changes: { additions: 12, deletions: 3 },
      }}
      defaultOpen={false}
    >
      File content appears here.
    </BasicToolV2>
  ),
}

export const Expanded = {
  render: () => (
    <BasicToolV2
      trigger={{
        title: "Read",
        subtitle: "src/index.ts",
        args: ["lines=1-50"],
        changes: { additions: 12, deletions: 3 },
      }}
      defaultOpen={true}
    >
      File content appears here.
    </BasicToolV2>
  ),
}

export const Pending = {
  render: () => (
    <BasicToolV2
      trigger={{
        title: "Read",
        subtitle: "src/index.ts",
        args: ["lines=1-50"],
        changes: { additions: 12, deletions: 3 },
      }}
      status="pending"
    />
  ),
}

export const NoChildren = {
  render: () => (
    <BasicToolV2
      trigger={{
        title: "Grep",
        subtitle: "pattern=TODO",
        args: ["recursive=true"],
      }}
    />
  ),
}

export const CustomTrigger = {
  render: () => (
    <BasicToolV2
      trigger={<span style={{ color: "#161616", "font-size": "13px", "font-weight": "440" }}>Custom trigger content</span>}
    >
      Expandable detail for custom trigger.
    </BasicToolV2>
  ),
}

export const Controlled = {
  render: () => {
    const [open, setOpen] = createSignal(false)
    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "16px", "max-width": "420px" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            padding: "4px 10px",
            "font-size": "12px",
            "border-radius": "6px",
            border: "1px solid rgba(0,0,0,0.15)",
            background: "#fff",
            color: "#161616",
            cursor: "pointer",
          }}
        >
          Toggle from outside: {open() ? "Open" : "Closed"}
        </button>
        <BasicToolV2
          trigger={{
            title: "Write",
            subtitle: "src/utils.ts",
            changes: { additions: 8, deletions: 2 },
          }}
          open={open()}
          onOpenChange={setOpen}
        >
          Controlled content.
        </BasicToolV2>
      </div>
    )
  },
}
