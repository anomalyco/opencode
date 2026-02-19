// @ts-nocheck
import * as mod from "./diff"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Diff", mod })
export default { title: "UI/Diff", component: story.meta.component }
export const Basic = story.Basic
