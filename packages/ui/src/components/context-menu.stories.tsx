// @ts-nocheck
import * as mod from "./context-menu"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/ContextMenu", mod })
export default { ...story.meta }
export const Basic = story.Basic
