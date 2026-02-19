// @ts-nocheck
import * as mod from "./typewriter"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Typewriter", mod })
export default { title: "UI/Typewriter", component: story.meta.component }
export const Basic = story.Basic
