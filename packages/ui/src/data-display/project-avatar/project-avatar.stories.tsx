import { For } from "solid-js"
import image from "../../assets/favicon/apple-touch-icon.png"
import { ProjectAvatar, PROJECT_AVATAR_VARIANTS, type ProjectAvatarProps } from "./project-avatar"

const docs = `### Overview
Saturated 16px project avatar with color variants and optional unread dot.

### API
- Required: \`fallback\` string.
- Optional: \`src\`, \`variant\`, \`unread\`, \`label\` and \`generated\` (a project seed).

### Variants
- Color: orange, yellow, cyan, green, red, pink, blue, purple, gray.
- Outline: neutral, muted style for de-emphasized projects (e.g. recently closed).
- Image vs initial content state.
- Unread dot with corner mask when \`unread\` is set.
- Switch the Avatars style to Generated in the panel to use the seed. An image or outline takes precedence.

### Theming
- Uses \`--v2-avatar-bg-*\` and \`--v2-avatar-border-*\` tokens with inset box-shadow borders.
`

export default {
  title: "UI/ProjectAvatar",
  id: "ui-project-avatar",
  component: ProjectAvatar,
  tags: ["autodocs"],
  parameters: {
    motion: ["projectAvatar.style"],
    docs: {
      description: {
        component: docs,
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: [...PROJECT_AVATAR_VARIANTS, "outline"],
    },
  },
  args: {
    fallback: "O",
    variant: "orange",
    src: "",
    generated: "opencode",
    label: "",
    unread: false,
  } satisfies ProjectAvatarProps,
  render: Preview,
}

function Preview(args: ProjectAvatarProps) {
  return (
    <ProjectAvatar
      {...args}
      classList={{
        "[&_[data-slot=project-avatar-label]]:visible! [&_[data-slot=project-avatar-initial]]:invisible": !!args.label,
      }}
    />
  )
}

export const Basic = {}

export const WithImage = {
  args: {
    src: image,
    fallback: "O",
    variant: "blue",
  },
}

export const AllVariants = {
  render: (args: ProjectAvatarProps) => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <For each={PROJECT_AVATAR_VARIANTS}>
        {(variant) => <Preview {...args} fallback={variant[0].toUpperCase()} variant={variant} />}
      </For>
    </div>
  ),
}

export const Outline = {
  args: {
    fallback: "O",
    variant: "outline",
  },
}

export const Unread = {
  args: {
    fallback: "O",
    variant: "orange",
    unread: true,
  },
}

export const AllVariantsUnread = {
  args: { unread: true },
  render: AllVariants.render,
}
