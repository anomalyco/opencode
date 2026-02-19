// @ts-nocheck
import * as mod from "./markdown"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/Markdown",
  mod,
  args: {
    text: "# Markdown\n\nSome *markdown* with `inline code`.\n\n```ts\nconst hello = 'world'\n```",
  },
})
export default { title: "UI/Markdown", id: "components-markdown", component: story.meta.component }
export const Basic = story.Basic
