import { For } from "solid-js"
import image from "../../assets/favicon/apple-touch-icon.png"
import { Avatar, type AvatarProps } from "./avatar"

const sizes = ["small", "normal", "large"] satisfies AvatarProps["size"][]

const docs = `### Overview
Avatar matching OpenCode DS variants from Figma, for user lists and headers.

### API and states
Provide a fallback string. The avatar displays its first grapheme or the image at src. Background and foreground override the fallback colors.
Sizes are small (16px), normal (20px) and large (28px); user avatars are circular and org avatars have rounded corners.

### Accessibility and theming
Provide accessible context alongside image avatars. The root uses data-component="avatar-v2" and size, kind and image-state attributes.`

// Avatar captures its image source on mount; replace it when the source control changes.
function Preview(args: AvatarProps) {
  return <For each={[args.src]}>{(src) => <Avatar {...args} src={src} />}</For>
}

export default {
  title: "UI/Avatar",
  id: "ui-avatar",
  component: Avatar,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
  args: { fallback: "WW", size: "large", kind: "user", src: "", background: "", foreground: "" } satisfies AvatarProps,
  argTypes: {
    size: { control: "select", options: sizes },
    kind: { control: "select", options: ["user", "org"] satisfies AvatarProps["kind"][] },
  },
  render: Preview,
}

export const Basic = {}

export const WithImage = { args: { src: image } }

export const Sizes = {
  render: (args: AvatarProps) => (
    <div class="flex items-center gap-3">
      <For each={sizes}>{(size) => <Preview {...args} size={size} />}</For>
    </div>
  ),
}

export const OrgVariant = { args: { kind: "org" }, render: Sizes.render }
