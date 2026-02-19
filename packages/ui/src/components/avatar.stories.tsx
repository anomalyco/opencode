// @ts-nocheck
import * as mod from "./avatar"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Avatar", mod, args: { fallback: "A" } })
export default { title: "UI/Avatar", id: "components-avatar", component: story.meta.component }
export const Basic = story.Basic
