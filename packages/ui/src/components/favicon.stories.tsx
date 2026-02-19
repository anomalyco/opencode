// @ts-nocheck
import * as mod from "./favicon"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Favicon", mod })
export default { title: "UI/Favicon", component: story.meta.component }
export const Basic = story.Basic
