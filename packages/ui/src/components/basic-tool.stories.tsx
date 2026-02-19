// @ts-nocheck
import * as mod from "./basic-tool"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/BasicTool", mod })
export default { ...story.meta }
export const Basic = story.Basic
