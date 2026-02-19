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
export default { ...story.meta }
export const Basic = story.Basic
