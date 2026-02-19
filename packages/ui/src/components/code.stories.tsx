// @ts-nocheck
import * as mod from "./code"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Code", mod })
export default { title: "UI/Code", id: "components-code", component: story.meta.component }
export const Basic = story.Basic
