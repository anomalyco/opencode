// @ts-nocheck
import * as mod from "./list"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/List",
  mod,
  args: {
    items: ["One", "Two", "Three", "Four"],
    key: (x: string) => x,
    children: (x: string) => x,
    search: true,
  },
})
export default { title: "UI/List", id: "components-list", component: story.meta.component }
export const Basic = story.Basic
