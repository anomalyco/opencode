// @ts-nocheck
import * as mod from "./diff-changes"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/DiffChanges", mod })
export default { title: "UI/DiffChanges", id: "components-diff-changes", component: story.meta.component }
export const Basic = story.Basic
