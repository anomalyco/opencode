// @ts-nocheck
import * as mod from "./diff-ssr"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/DiffSSR", mod })
export default { title: "UI/DiffSSR", component: story.meta.component }
export const Basic = story.Basic
