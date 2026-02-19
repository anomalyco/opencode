// @ts-nocheck
import * as mod from "./line-comment"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/LineComment", mod })
export default { ...story.meta }
export const Basic = story.Basic
