// @ts-nocheck
import * as mod from "./session-review"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/SessionReview", mod })
export default { ...story.meta }
export const Basic = story.Basic
