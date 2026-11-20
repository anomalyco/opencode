import { expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import { createPasskeyGroups } from "./passkey-groups"

const tab = (n: number) => Browser.TabID.make(`tab_${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`)

test("the agent driving one tab of a pop-up group makes the whole group refuse, and a later pop-up too", () => {
  const groups = createPasskeyGroups()
  // A person's tab opened a pop-up, which opened another; an unrelated tab stays apart.
  groups.join(tab(1))
  groups.join(tab(2), tab(1))
  groups.join(tab(3), tab(2))
  groups.join(tab(4))

  expect([1, 2, 3, 4].map((n) => groups.restricted(tab(n)))).toEqual([false, false, false, false])
  // The agent drives the second pop-up: its opener and the first pop-up start refusing, the other tab does not.
  expect(groups.restrict(tab(3))).toEqual([tab(1), tab(2)])
  expect([1, 2, 3, 4].map((n) => groups.restricted(tab(n)))).toEqual([true, true, true, false])
  expect(groups.restrict(tab(1))).toEqual([])

  // A pop-up the restricted opener opens later refuses from its first document, even after its opener closed.
  groups.remove(tab(1))
  groups.join(tab(5), tab(2))
  expect(groups.restricted(tab(5))).toBe(true)
})
