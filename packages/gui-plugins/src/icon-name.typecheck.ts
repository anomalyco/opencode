// Fails the typecheck when the GUI SDK's icon names drift from the app's icon catalog. Nothing imports this file. Run
// `bun run generate` in packages/plugin to update them.

import type { IconName } from "@Mackery6969/plugin/gui"
import type { iconNames } from "@Mackery6969/ui/icons/catalog"

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

export const iconNamesMatch: Same<IconName, ReturnType<typeof iconNames>[number]> = true
