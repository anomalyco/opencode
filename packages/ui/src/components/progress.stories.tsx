// @ts-nocheck
import * as mod from "./progress"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/Progress",
  mod,
  args: {
    value: 60,
    maxValue: 100,
    children: "Progress",
    showValueLabel: true,
  },
})
export default { ...story.meta }
export const Basic = story.Basic
