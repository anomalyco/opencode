// @ts-nocheck
import * as mod from "./icon"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Icon", mod, args: { name: "check" } })
export default { ...story.meta }
export const Basic = story.Basic
