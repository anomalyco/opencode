// @ts-nocheck
import * as mod from "./tabs"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Tabs", mod })
export default { title: "UI/Tabs", component: story.meta.component }
export const Basic = story.Basic
