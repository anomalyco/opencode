// @ts-nocheck
import * as mod from "./message-part"
import { create } from "@opencode-ai/ui/storybook/scaffold"

const story = create({ title: "UI/MessagePart", mod })
export default { title: "UI/MessagePart", id: "components-message-part", component: story.meta.component }
export const Basic = story.Basic
