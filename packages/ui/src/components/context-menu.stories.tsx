// @ts-nocheck
import * as mod from "./context-menu"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/ContextMenu", mod })
export default { title: "UI/ContextMenu", component: story.meta.component }
export const Basic = story.Basic
