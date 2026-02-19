// @ts-nocheck
import * as mod from "./switch"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Switch", mod, args: { defaultChecked: true } })
export default { ...story.meta }
export const Basic = story.Basic
