// @ts-nocheck
import * as mod from "./line-comment"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/LineComment", mod })
export default { title: "UI/LineComment", id: "components-line-comment", component: story.meta.component }
export const Basic = story.Basic
