// @ts-nocheck
import * as mod from "./message-part"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/MessagePart", mod })
export default { title: "UI/MessagePart", component: story.meta.component }
export const Basic = story.Basic
