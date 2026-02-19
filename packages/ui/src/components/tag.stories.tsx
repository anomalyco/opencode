// @ts-nocheck
import * as mod from "./tag"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Tag", mod, args: { children: "Tag" } })
export default { title: "UI/Tag", id: "components-tag", component: story.meta.component }
export const Basic = story.Basic
