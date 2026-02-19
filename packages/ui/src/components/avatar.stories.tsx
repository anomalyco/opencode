// @ts-nocheck
import * as mod from "./avatar"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Avatar", mod, args: { fallback: "A" } })
export default { ...story.meta }
export const Basic = story.Basic
