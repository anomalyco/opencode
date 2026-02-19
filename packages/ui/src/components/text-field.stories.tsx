// @ts-nocheck
import * as mod from "./text-field"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/TextField",
  mod,
  args: {
    label: "Label",
    placeholder: "Type here…",
    defaultValue: "Hello",
  },
})
export default { title: "UI/TextField", id: "components-text-field", component: story.meta.component }
export const Basic = story.Basic
