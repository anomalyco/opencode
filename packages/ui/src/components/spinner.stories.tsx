// @ts-nocheck
import * as mod from "./spinner"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Spinner", mod })
export default { ...story.meta }
export const Basic = story.Basic
