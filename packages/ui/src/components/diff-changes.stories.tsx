// @ts-nocheck
import * as mod from "./diff-changes"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/DiffChanges", mod })
export default { ...story.meta }
export const Basic = story.Basic
