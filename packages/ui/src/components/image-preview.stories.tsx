// @ts-nocheck
import * as mod from "./image-preview"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/ImagePreview",
  mod,
  args: {
    src: "https://placehold.co/640x360/png",
    alt: "Preview",
  },
})
export default { ...story.meta }
export const Basic = story.Basic
