// @ts-nocheck
import * as mod from "./checkbox"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Checkbox", mod, args: { children: "Checkbox", defaultChecked: true } })
export default { title: "UI/Checkbox", component: story.meta.component }
export const Basic = story.Basic
