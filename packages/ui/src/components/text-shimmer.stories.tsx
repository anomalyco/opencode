// @ts-nocheck
import * as mod from "./text-shimmer"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/TextShimmer", mod, args: { children: "Loading…" } })
export default { ...story.meta }
export const Basic = story.Basic
