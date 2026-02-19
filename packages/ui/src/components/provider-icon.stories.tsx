// @ts-nocheck
import * as mod from "./provider-icon"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/ProviderIcon", mod, args: { id: "openai" } })
export default { title: "UI/ProviderIcon", id: "components-provider-icon", component: story.meta.component }
export const Basic = story.Basic
