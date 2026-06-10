// @ts-nocheck
import { For } from "solid-js"
import { ProjectAvatar, PROJECT_AVATAR_VARIANTS } from "./project-avatar-v2"

const docs = `### Overview
Saturated 16px project avatar with color variants and optional unread dot.

### API
- Required: \`fallback\` string.
- Optional: \`src\`, \`variant\`, \`unread\`.

### Variants
- Color: orange, yellow, cyan, green, red, pink, blue, purple, gray.
- Image vs initial content state.
- Unread dot with corner mask when \`unread\` is set.

### Theming
- Uses \`--v2-avatar-bg-*\` and \`--v2-avatar-border-*\` tokens with inset box-shadow borders.
`

export default {
  title: "UI V2/ProjectAvatar",
  id: "components-project-avatar-v2",
  component: ProjectAvatar,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: [...PROJECT_AVATAR_VARIANTS],
    },
  },
  args: {
    fallback: "O",
    variant: "orange",
  },
}

export const Basic = {}

export const WithImage = {
  args: {
    src: "https://placehold.co/32x32/png",
    fallback: "O",
    variant: "blue",
  },
}

export const AllVariants = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <For each={PROJECT_AVATAR_VARIANTS}>
        {(variant) => <ProjectAvatar fallback={variant[0].toUpperCase()} variant={variant} />}
      </For>
    </div>
  ),
}

export const Unread = {
  args: {
    fallback: "O",
    variant: "orange",
    unread: true,
  },
}

export const AllVariantsUnread = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <For each={PROJECT_AVATAR_VARIANTS}>
        {(variant) => <ProjectAvatar fallback={variant[0].toUpperCase()} variant={variant} unread />}
      </For>
    </div>
  ),
}

export const Loading = {
  args: {
    fallback: "O",
    variant: "orange",
    loading: true,
  },
}

export const LoadingAndUnread = {
  args: {
    fallback: "O",
    variant: "blue",
    loading: true,
    unread: true,
  },
}
