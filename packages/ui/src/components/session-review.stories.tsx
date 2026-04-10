// @ts-nocheck
import * as mod from "./session-review"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/SessionReview", mod })
export default { title: "UI/SessionReview", id: "components-session-review", component: story.meta.component }
export const Basic = story.Basic
