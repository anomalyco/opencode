// @ts-nocheck
import * as mod from "./line-comment"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/LineComment", mod })
export default { title: "UI/LineComment", component: story.meta.component }
export const Basic = story.Basic
