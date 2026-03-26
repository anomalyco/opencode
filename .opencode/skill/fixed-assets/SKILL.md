---
name: fixed-assets
description: Use this when recording, depreciating, impairing, or disposing of fixed assets and capital expenditures.
---

## Use this when

- The user asks whether a purchase should be capitalized or expensed.
- Recording acquisition of property, plant, equipment, or intangible assets.
- Calculating or reviewing depreciation/amortization schedules.
- Processing asset disposal, retirement, write-off, or impairment.
- Reviewing the fixed asset register for accuracy or audit preparation.

## Workflow

1. **Determine capitalization eligibility.** Apply the company's capitalization threshold. Pull the chart of accounts and existing asset accounts via `pennylane_ledger_accounts_list`.
   - Tangible assets: furniture, equipment, vehicles, leasehold improvements, buildings.
   - Intangible assets: software licenses (perpetual), patents, development costs meeting capitalization criteria (IAS 38 / ASC 350).
   - Below threshold: expense immediately regardless of useful life.
   - At or above threshold: capitalize if useful life exceeds one year.
2. **Record acquisition.**
   - **JE Template — Acquisition:**
     - Debit: Fixed Asset account (at cost including purchase price + delivery + installation + testing).
     - Credit: AP / Cash / Loan payable.
   - Cost includes all expenditures necessary to bring the asset to its intended use. Exclude training costs and ongoing maintenance.
   - For self-constructed assets: capitalize direct materials, direct labor, and allocated overhead during construction.
3. **Assign depreciation parameters.**
   - **Asset category** determines the method and useful life range:
     - Office equipment: 3-7 years, straight-line.
     - Computer hardware: 3-5 years, straight-line.
     - Vehicles: 4-6 years, straight-line or declining balance.
     - Furniture: 5-10 years, straight-line.
     - Buildings: 20-40 years, straight-line.
     - Leasehold improvements: shorter of useful life or remaining lease term.
     - Software (perpetual license): 3-5 years, straight-line.
   - **Depreciation methods:**
     - **Straight-line:** (Cost - Residual Value) / Useful Life. Default for most assets.
     - **Declining balance:** Cost x Depreciation Rate. Accelerated — higher expense in early years. Use when asset productivity declines over time.
     - **Units of production:** (Cost - Residual Value) x (Actual Units / Total Expected Units). Use for assets whose wear correlates with usage, not time.
   - **Residual value:** Estimate the disposal value at end of life. Conservative default: zero for most equipment. Vehicles may retain 10-20%.
4. **Record periodic depreciation.**
   - **JE Template — Depreciation:**
     - Debit: Depreciation Expense (P&L, by department/function).
     - Credit: Accumulated Depreciation (contra-asset on balance sheet).
   - Frequency: monthly entries for management accounts; at minimum quarterly.
5. **Assess impairment triggers.** Review when:
   - Asset is physically damaged or obsolete.
   - Market value has declined significantly.
   - Asset is idle or usage has dropped materially.
   - Business segment using the asset is underperforming.
   - **JE Template — Impairment:**
     - Debit: Impairment Loss (P&L, typically reported separately).
     - Credit: Accumulated Depreciation (or direct reduction of asset carrying value).
   - Write down to recoverable amount (higher of fair value less costs to sell, and value in use).
6. **Record disposal.**
   - **JE Template — Disposal:**
     - Debit: Cash / Receivable (proceeds, if any).
     - Debit: Accumulated Depreciation (full balance for this asset).
     - Debit or Credit: Gain/Loss on Disposal (plug — difference between proceeds and net book value).
     - Credit: Fixed Asset account (original cost).
   - Ensure depreciation is recorded up to the disposal date before removing the asset.

## Accounting Judgment

- The capitalize-vs-expense decision is the most frequent judgment call. When in doubt, expense. Capitalization that inflates assets and defers expense recognition is a common audit finding.
- Useful life estimates should reflect actual expected usage, not tax lives. Review annually and adjust prospectively if expectations change.
- Component depreciation: if an asset has components with materially different useful lives (e.g., building shell vs. HVAC system), depreciate separately.
- Residual value is often overstated to reduce depreciation expense. Conservative stance: set to zero unless there is a contractual buyback or reliable resale market.
- Impairment is required when indicators exist — it is not optional or deferrable. Failing to impair overstates assets and income.

## Output Format

1. **Conclusion** — Capitalize or expense? Depreciation method and useful life. Any impairment or disposal required.
2. **Treatment** — Complete journal entries with accounts, amounts, and posting period. Depreciation schedule if new asset.
3. **Risks** — Overcapitalization, incorrect useful life, missed impairment, incomplete disposal (ghost assets on register).
4. **Missing info** — Invoice for cost verification, physical inspection results, management's intended use, lease term (for leasehold improvements).
5. **Next action** — Post JE, update fixed asset register, schedule next impairment review, tag for physical verification at next count.

## Edge Cases

- **Leasehold improvements:** Depreciate over the shorter of useful life or remaining lease term (including reasonably certain renewal periods). If lease is month-to-month, expense immediately.
- **Asset swaps / trade-ins:** Record the new asset at fair value of consideration given. Recognize gain or loss on the old asset. If fair value is not determinable, use carrying value of the asset given up (no gain recognized).
- **Fully depreciated assets still in use:** Net book value is zero, but the asset remains on the register at cost with equal accumulated depreciation. Do not remove until physically disposed. No further depreciation.
- **Government grants for asset purchase:** Reduce the asset cost by the grant amount (net method) or record the grant as deferred income and amortize over the asset's useful life (gross method). Disclose the method used.
- **Bulk purchases:** If a single invoice covers multiple assets, allocate the total cost to individual items based on relative fair values. Each item gets its own depreciation schedule.

## Guardrails

- Never capitalize an item below the company's capitalization threshold, even if it has a long useful life.
- Always record depreciation up to the disposal date before removing an asset.
- Do not change depreciation method or useful life retroactively. Changes are prospective only.
- Flag any asset that has not been physically verified in over 24 months — ghost assets inflate the balance sheet.
- Refuse to capitalize costs that are clearly maintenance or repairs (e.g., replacing a broken part with an equivalent part does not extend useful life).
- Ensure tax depreciation and book depreciation are tracked separately when they differ. Do not use tax lives for financial reporting without justification.
