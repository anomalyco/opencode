// @ts-nocheck
import * as mod from "./dock-prompt"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/DockPrompt",
  mod,
  args: {
    kind: "question",
    header: "Header",
    children: "Prompt content",
    footer: "Footer",
  },
})
export default { title: "UI/DockPrompt", id: "components-dock-prompt", component: story.meta.component }
export const Basic = story.Basic
