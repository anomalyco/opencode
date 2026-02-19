// @ts-nocheck
import * as mod from "./font"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Font", mod })
export default { ...story.meta }
export const Basic = story.Basic
