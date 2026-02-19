// @ts-nocheck
import * as mod from "./tag"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Tag", mod, args: { children: "Tag" } })
export default { ...story.meta }
export const Basic = story.Basic
