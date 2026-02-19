// @ts-nocheck
import * as mod from "./tooltip"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Tooltip", mod, args: { value: "Tooltip", children: "Hover me" } })
export default { title: "UI/Tooltip", component: story.meta.component }
export const Basic = story.Basic
