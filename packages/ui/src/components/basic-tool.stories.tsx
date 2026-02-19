// @ts-nocheck
import * as mod from "./basic-tool"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/BasicTool", mod })
export default { title: "UI/Basic Tool", id: "components-basic-tool", component: story.meta.component }
export const Basic = story.Basic
