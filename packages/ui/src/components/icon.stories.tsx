// @ts-nocheck
import * as mod from "./icon"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Icon", mod, args: { name: "check" } })
export default { title: "UI/Icon", component: story.meta.component }
export const Basic = story.Basic
