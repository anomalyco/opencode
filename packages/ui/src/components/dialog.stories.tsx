// @ts-nocheck
import * as mod from "./dialog"
import { create } from "../storybook/scaffold"

const story = create({
  title: "UI/Dialog",
  mod,
  args: { title: "Dialog", description: "Description", children: "Body" },
})
export default { ...story.meta }
export const Basic = story.Basic
