// @ts-nocheck
import * as mod from "./popover"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/Popover",
  mod,
  args: {
    trigger: "Open popover",
    title: "Popover",
    description: "Optional description",
    defaultOpen: true,
    children: "Popover content",
  },
})
export default { title: "UI/Popover", component: story.meta.component }
export const Basic = story.Basic
