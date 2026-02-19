// @ts-nocheck
import * as mod from "./session-turn"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/SessionTurn", mod })
export default { ...story.meta }
export const Basic = story.Basic
