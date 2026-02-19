// @ts-nocheck
import * as mod from "./spinner"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Spinner", mod })
export default { title: "UI/Spinner", id: "components-spinner", component: story.meta.component }
export const Basic = story.Basic
