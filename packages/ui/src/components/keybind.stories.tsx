// @ts-nocheck
import * as mod from "./keybind"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Keybind", mod, args: { children: "Cmd+K" } })
export default { ...story.meta }
export const Basic = story.Basic
