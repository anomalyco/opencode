// @ts-nocheck
import * as mod from "./accordion"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Accordion", mod })
export default { ...story.meta }
export const Basic = story.Basic
