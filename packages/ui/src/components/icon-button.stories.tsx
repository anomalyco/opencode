// @ts-nocheck
import * as mod from "./icon-button"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/IconButton", mod, args: { icon: "check", "aria-label": "Icon" } })
export default { ...story.meta }
export const Basic = story.Basic
