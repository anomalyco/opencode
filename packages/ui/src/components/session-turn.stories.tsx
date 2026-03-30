// @ts-nocheck
import * as mod from "./session-turn"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/SessionTurn", mod })
export default { title: "UI/SessionTurn", id: "components-session-turn", component: story.meta.component }
export const Basic = story.Basic
