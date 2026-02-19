// @ts-nocheck
import * as mod from "./logo"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Logo", mod })
export default { ...story.meta }
export const Basic = story.Basic
