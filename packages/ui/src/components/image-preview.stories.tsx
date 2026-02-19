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
export default { title: "UI/ImagePreview", id: "components-image-preview", component: story.meta.component }
export const Basic = story.Basic
