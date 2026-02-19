// @ts-nocheck
import * as mod from "./tabs"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Tabs", mod })
export default { ...story.meta }
export const Basic = story.Basic
