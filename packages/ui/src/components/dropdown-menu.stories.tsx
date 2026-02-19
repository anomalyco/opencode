// @ts-nocheck
import * as mod from "./dropdown-menu"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/DropdownMenu", mod })
export default { title: "UI/DropdownMenu", id: "components-dropdown-menu", component: story.meta.component }
export const Basic = story.Basic
