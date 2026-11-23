// Fails the typecheck when the GUI SDK's names of the app's icons drift from the app's icon catalog. Nothing imports
// this file. Run `bun run generate` in packages/plugin to update them.

import type { AppIconName } from "@opencode/plugin/gui"
import type { iconNames } from "@opencode/ui/icons/catalog"

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

export const iconNamesMatch: Same<AppIconName, ReturnType<typeof iconNames>[number]> = true
