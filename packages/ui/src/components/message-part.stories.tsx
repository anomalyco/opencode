// @ts-nocheck
import * as mod from "./message-part"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/MessagePart", mod })
export default { ...story.meta }
export const Basic = story.Basic
