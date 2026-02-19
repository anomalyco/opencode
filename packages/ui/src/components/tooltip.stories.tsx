// @ts-nocheck
import * as mod from "./tooltip"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Tooltip", mod, args: { value: "Tooltip", children: "Hover me" } })
export default { ...story.meta }
export const Basic = story.Basic
