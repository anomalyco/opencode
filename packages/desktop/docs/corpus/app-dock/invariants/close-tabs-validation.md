# Invariant: `close-tabs-validation` - Close-tabs Validation

> Clauses: 7 | Unwanted: 4 | Witnesses: app-dock-security.test.ts:804-871

## Clauses
- close-tabs with invalid scope is rejected *(measured: app-dock-security.test.ts:804-871)*
- close-tabs others destroys only other tabs, keeps target *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right validates complete visual order *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right with wrong visual order is rejected *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right with foreign tab in order is rejected *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right with duplicate tabs in order is rejected *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right closes only visual-right tabs *(measured: app-dock-security.test.ts:804-871)*

## Unwanted
- Invalid close-tabs scope is accepted *(measured: app-dock-security.test.ts:804-871)*
- close-tabs others destroys target *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right accepts incomplete or wrong visual order *(measured: app-dock-security.test.ts:804-871)*
- close-tabs right closes non-right tabs *(measured: app-dock-security.test.ts:804-871)*

