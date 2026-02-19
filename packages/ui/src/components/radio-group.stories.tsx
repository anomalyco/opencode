// @ts-nocheck
import * as mod from "./radio-group"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/RadioGroup",
  mod,
  args: {
    options: ["One", "Two", "Three"],
    defaultValue: "One",
  },
})
export default { ...story.meta }
export const Basic = story.Basic
