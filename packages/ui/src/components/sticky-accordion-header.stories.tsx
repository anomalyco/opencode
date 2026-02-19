// @ts-nocheck
import * as mod from "./sticky-accordion-header"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/StickyAccordionHeader", mod, args: { children: "Sticky header" } })
export default { ...story.meta }
export const Basic = story.Basic
