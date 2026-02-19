// @ts-nocheck
import * as mod from "./progress-circle"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/ProgressCircle", mod, args: { percentage: 65, size: 48 } })
export default { ...story.meta }
export const Basic = story.Basic
