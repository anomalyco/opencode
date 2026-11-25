import { For } from "solid-js"
import { FileIcon, type FileIconProps } from "./file-icon"

type Args = FileIconProps["node"] & Pick<FileIconProps, "expanded" | "mono">

const docs = `### Overview
File and folder icon renderer based on file name and extension.

Use in file trees and lists.

### API
- Required: \`node\` with \`path\` and \`type\`.
- Optional: \`expanded\` (for folders), \`mono\` for monochrome rendering.

### Variants and states
- Folder vs file icons; expanded folder variant.

### Behavior
- Maps file names and extensions to sprite icons.

### Accessibility
- Provide adjacent text labels for filenames; icons are decorative.

### Theming/tokens
- Uses \`data-component="file-icon"\` and sprite-based styling.

`

export default {
  title: "UI/FileIcon",
  id: "components-file-icon",
  component: FileIcon,
  args: { path: "package.json", type: "file", expanded: false, mono: true },
  argTypes: { type: { control: "select", options: ["file", "directory"] } },
  render: (args: Args) => <FileIcon node={args} expanded={args.expanded} mono={args.mono} />,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {}

export const Folder = {
  args: {
    path: "src",
    type: "directory",
    expanded: true,
    mono: false,
  },
}

export const Samples = {
  args: { path: "README.md", mono: false },
  render: (args: Args) => {
    const items = [
      args,
      { path: "package.json", type: "file" },
      { path: "tsconfig.json", type: "file" },
      { path: "index.ts", type: "file" },
      { path: "styles.css", type: "file" },
      { path: "logo.svg", type: "file" },
      { path: "photo.png", type: "file" },
      { path: "Dockerfile", type: "file" },
      { path: ".env", type: "file" },
      { path: "src", type: "directory" },
      { path: "public", type: "directory" },
    ] as const

    return (
      <div
        style={{
          display: "grid",
          gap: "12px",
          "grid-template-columns": "repeat(auto-fill, minmax(120px, 1fr))",
        }}
      >
        <For each={items}>
          {(node) => (
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <FileIcon node={node} mono={args.mono} expanded={args.expanded} />
              <div style={{ "font-size": "12px", color: "var(--text-weak)" }}>{node.path}</div>
            </div>
          )}
        </For>
      </div>
    )
  },
}
