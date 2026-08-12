import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import { OpenCodeDriver } from "opencode-drive"

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false

type Assert<Value extends true> = Value

type Managed = ReturnType<typeof OpenCodeDriver.make>
declare const managed: Managed
const scoped = Effect.scoped(managed)
type Scoped = typeof scoped

export type ManagedRequiresScope = Assert<
  Equal<Effect.Services<Managed>, Scope.Scope>
>
export type ScopedIsRunnable = Assert<Equal<Effect.Services<Scoped>, never>>

declare const driver: OpenCodeDriver.Driver
export type PrimaryUiIsCanonical = Assert<
  Equal<typeof driver.ui, typeof driver.tui.ui>
>
export type AdditionalUiIsCanonical = Assert<
  Equal<
    Effect.Success<ReturnType<typeof driver.tuis.launch>>["ui"],
    OpenCodeDriver.Ui
  >
>
