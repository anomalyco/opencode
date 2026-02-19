// @ts-nocheck
import * as mod from "./code"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Code", mod })
export default { ...story.meta }
export const Basic = story.Basic
