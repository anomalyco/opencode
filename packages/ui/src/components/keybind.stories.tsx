// @ts-nocheck
import * as mod from "./keybind"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Keybind", mod, args: { children: "Cmd+K" } })
export default { title: "UI/Keybind", id: "components-keybind", component: story.meta.component }
export const Basic = story.Basic
