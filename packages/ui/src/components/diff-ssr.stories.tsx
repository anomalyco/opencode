// @ts-nocheck
import * as mod from "./diff-ssr"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/DiffSSR", mod })
export default { ...story.meta }
export const Basic = story.Basic
