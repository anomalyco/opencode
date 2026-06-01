// @ts-nocheck
import * as mod from "./select-v2"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/SelectV2",
  mod,
  args: {
    options: ["One", "Two", "Three"],
    current: "One",
    placeholder: "Choose...",
  },
})

export default {
  title: "UI/SelectV2",
  id: "components-select-v2",
  component: story.meta.component,
  tags: ["autodocs"],
}

export const Basic = story.Basic
