// @ts-nocheck
import * as mod from "./resize-handle"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/ResizeHandle",
  mod,
  args: {
    direction: "horizontal",
    size: 240,
    min: 120,
    max: 480,
    onResize: () => {},
    style: "height:24px;border:1px dashed color-mix(in oklab, var(--text-base) 20%, transparent)",
  },
})
export default { ...story.meta }
export const Basic = story.Basic
