// @ts-nocheck
import * as mod from "./app-icon"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/AppIcon", mod, args: { id: "vscode" } })
export default { ...story.meta }
export const Basic = story.Basic
