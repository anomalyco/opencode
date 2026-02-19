// @ts-nocheck
import * as mod from "./select"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/Select",
  mod,
  args: {
    options: ["One", "Two", "Three"],
    current: "One",
    placeholder: "Choose…",
    variant: "secondary",
    size: "normal",
  },
})
export default { title: "UI/Select", id: "components-select", component: story.meta.component }
export const Basic = story.Basic
