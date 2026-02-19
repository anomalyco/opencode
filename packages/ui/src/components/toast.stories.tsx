// @ts-nocheck
import * as mod from "./toast"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Toast", mod })
export default { title: "UI/Toast", id: "components-toast", component: story.meta.component }
export const Basic = story.Basic
