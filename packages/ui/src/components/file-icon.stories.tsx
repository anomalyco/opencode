// @ts-nocheck
import * as mod from "./file-icon"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/FileIcon",
  mod,
  args: {
    node: { path: "package.json", type: "file" },
    mono: true,
  },
})
export default { title: "UI/FileIcon", id: "components-file-icon", component: story.meta.component }
export const Basic = story.Basic
