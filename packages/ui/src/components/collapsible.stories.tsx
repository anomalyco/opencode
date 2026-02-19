// @ts-nocheck
import * as mod from "./collapsible"
import { create } from "../storybook/scaffold"

const story = create({ title: "UI/Collapsible", mod })
export default { title: "UI/Collapsible", id: "components-collapsible", component: story.meta.component }
export const Basic = story.Basic
