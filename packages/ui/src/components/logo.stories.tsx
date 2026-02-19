// @ts-nocheck
import * as mod from "./logo"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Logo", mod })
export default { title: "UI/Logo", component: story.meta.component }
export const Basic = story.Basic
