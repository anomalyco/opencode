// @ts-nocheck
import * as mod from "./hover-card"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/HoverCard",
  mod,
  args: {
    trigger: "Hover me",
    children: "Hover card content",
  },
})
export default { title: "UI/HoverCard", component: story.meta.component }
export const Basic = story.Basic
