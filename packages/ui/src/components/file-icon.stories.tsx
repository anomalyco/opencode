// @ts-nocheck
import * as mod from "./file-icon"
import { create } from "../storybook/scaffold"

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

const story = create({
  title: "UI/FileIcon",
  mod,
  args: {
    node: { path: "package.json", type: "file" },
    mono: true,
  },
})

export default {
  title: "UI/FileIcon",
  id: "components-file-icon",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = story.Basic

export const Folder = {
  args: {
    node: { path: "src", type: "directory" },
    expanded: true,
    mono: false,
  },
}

export const Samples = {
  render: () => {
    const items = [
      { path: "README.md", type: "file" },
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
        {items.map((node) => (
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <mod.FileIcon node={{ path: node.path, type: node.type }} mono={false} />
            <div style={{ "font-size": "12px", color: "var(--text-weak)" }}>{node.path}</div>
          </div>
        ))}
      </div>
    )
  },
}
