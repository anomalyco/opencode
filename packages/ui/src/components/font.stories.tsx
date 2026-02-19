// @ts-nocheck
import * as mod from "./font"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Font", mod })
export default { title: "UI/Font", id: "components-font", component: story.meta.component }
export const Basic = story.Basic
