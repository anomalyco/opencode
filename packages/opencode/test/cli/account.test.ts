import { describe, expect, it } from "bun:test"
import { Option } from "effect"

import { isActiveOrgChoice } from "../../src/cli/cmd/account"
import { AccountID, OrgID } from "../../src/account/schema"

describe("isActiveOrgChoice", () => {
  it("requires both account id and org id to match", () => {
    const active = Option.some({
      id: AccountID.make("account-1"),
      active_org_id: OrgID.make("org-1"),
    })

    expect(isActiveOrgChoice(active, { accountID: AccountID.make("account-1"), orgID: OrgID.make("org-1") })).toBe(true)
    expect(isActiveOrgChoice(active, { accountID: AccountID.make("account-2"), orgID: OrgID.make("org-1") })).toBe(false)
    expect(isActiveOrgChoice(active, { accountID: AccountID.make("account-1"), orgID: OrgID.make("org-2") })).toBe(false)
  })
})
