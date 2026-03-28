// @ts-nocheck
import * as mod from "./message-nav"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/MessageNav", mod })
export default { title: "UI/MessageNav", id: "components-message-nav", component: story.meta.component }
export const Basic = story.Basic
