// @ts-nocheck
import * as mod from "./provider-icon"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/ProviderIcon", mod, args: { id: "openai" } })
export default { ...story.meta }
export const Basic = story.Basic
