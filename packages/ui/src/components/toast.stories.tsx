// @ts-nocheck
import * as mod from "./toast"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Toast", mod })
export default { ...story.meta }
export const Basic = story.Basic
