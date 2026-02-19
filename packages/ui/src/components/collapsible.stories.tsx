// @ts-nocheck
import * as mod from "./collapsible"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Collapsible", mod })
export default { ...story.meta }
export const Basic = story.Basic
