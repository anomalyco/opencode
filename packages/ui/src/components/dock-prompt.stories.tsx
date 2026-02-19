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
export default { ...story.meta }
export const Basic = story.Basic
