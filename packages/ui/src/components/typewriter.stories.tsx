// @ts-nocheck
import * as mod from "./typewriter"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Typewriter", mod })
export default { ...story.meta }
export const Basic = story.Basic
