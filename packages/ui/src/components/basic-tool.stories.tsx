// @ts-nocheck
import * as mod from "./basic-tool"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/Basic Tool",
  mod,
  args: {
    icon: "mcp",
    defaultOpen: true,
    trigger: {
      title: "Basic Tool",
      subtitle: "Example subtitle",
      args: ["--flag", "value"],
    },
    children: "Details content",
  },
})
export default { title: "UI/Basic Tool", id: "components-basic-tool", component: story.meta.component }
export const Basic = story.Basic
