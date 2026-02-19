// @ts-nocheck
import * as mod from "./inline-input"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/InlineInput", mod, args: { placeholder: "Type...", value: "Inline" } })
export default { ...story.meta }
export const Basic = story.Basic
