# Static security review report

This report was generated from static repository analysis. It is intended for maintainer review and does not claim that every finding has been automatically fixed.

## Scan metadata

- Project: `opencode`
- Source: `github.com/anomalyco/opencode#dev`
- Scan ID: `5aba522a-243c-465a-ad62-a48d7a756ae3`
- Mode: `max`
- Risk score: **100/100**
- Findings included: **101**
- Files inspected: **999**
- Baseline: **no saved baseline**

## Risk breakdown

- Runtime / agent risk: **Critical** (100/100)
- CI / supply-chain posture: **Critical** (82/100)
- Dependency risk: **Moderate** (26/100)
- Secrets risk: **Critical** (83/100)

## Findings requiring review

### 1. Anthropic API key appears to be exposed

- Severity: `critical`
- Category: `secret_exposure`
- Rule: `secret.provider-token.committed`
- Location: `github/README.md:120`
- Confidence: 94% - Provider-format credential value was found outside documentation, tests, fixtures, placeholders, and redaction detector code.
- Recommendation: Revoke and rotate this credential, remove it from the repository, and read it only from server-side environment variables.
- Evidence: `ANTHROPIC_API_KEY=...redacted \`

### 2. High-risk secret name with assigned value

- Severity: `critical`
- Category: `secret_exposure`
- Rule: `secret.high-risk-name.assigned-value`
- Location: `github/README.md:120`
- Confidence: 82% - A sensitive env/secret variable is assigned a concrete non-placeholder value.
- Recommendation: Move the value to a server-only environment variable, rotate it if it was real, and commit only placeholders.
- Evidence: `ANTHROPIC_API_KEY=...redacted \`

### 3. Workflow uses pull_request_target

- Severity: `high`
- Category: `repo_security_posture`
- Rule: `github-actions.pull-request-target`
- Location: `.github/workflows/pr-management.yml:4`
- Confidence: 86% - GitHub Actions workflow declares pull_request_target.
- Recommendation: Use pull_request where possible, or strictly avoid checking out and executing untrusted fork code under privileged tokens.
- Evidence: `pull_request_target:`

### 4. Workflow uses pull_request_target

- Severity: `high`
- Category: `repo_security_posture`
- Rule: `github-actions.pull-request-target`
- Location: `.github/workflows/pr-standards.yml:4`
- Confidence: 86% - GitHub Actions workflow declares pull_request_target.
- Recommendation: Use pull_request where possible, or strictly avoid checking out and executing untrusted fork code under privileged tokens.
- Evidence: `pull_request_target:`

### 5. Workflow uses pull_request_target

- Severity: `high`
- Category: `repo_security_posture`
- Rule: `github-actions.pull-request-target`
- Location: `.github/workflows/vouch-check-pr.yml:4`
- Confidence: 86% - GitHub Actions workflow declares pull_request_target.
- Recommendation: Use pull_request where possible, or strictly avoid checking out and executing untrusted fork code under privileged tokens.
- Evidence: `pull_request_target:`

### 6. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/context/auth.ts:28`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function useAuthSession() {`

### 7. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/routes/workspace-picker.tsx:49`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function WorkspacePicker() {`

### 8. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/routes/workspace/[id]/billing/billing-section.tsx:29`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function BillingSection() {`

### 9. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/routes/workspace/[id]/billing/black-section.tsx:141`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function BlackSection() {`

### 10. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/routes/workspace/[id]/billing/monthly-limit-section.tsx:31`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function MonthlyLimitSection() {`

### 11. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/routes/workspace/[id]/billing/payment-section.tsx:29`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function PaymentSection() {`

### 12. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/routes/workspace/[id]/billing/redeem-section.tsx:34`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function RedeemSection() {`

### 13. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/routes/workspace/[id]/billing/reload-section.tsx:61`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function ReloadSection() {`

### 14. Server Action performs sensitive work without an obvious auth guard

- Severity: `high`
- Category: `server_action_risk`
- Rule: `nextjs.server-action.missing-auth`
- Location: `packages/console/app/src/routes/workspace/[id]/settings/settings-section.tsx:49`
- Confidence: 84% - File declares use server and performs mutation/sensitive work, but no auth guard signal was found.
- Recommendation: Verify the user session, role, and ownership inside the Server Action before doing sensitive work, and return/throw before mutation when access is denied.
- Evidence: `export function SettingsSection() {`

### 15. Dynamic tool selection from user input

- Severity: `high`
- Category: `unsafe_tool_calling`
- Rule: `rule.unsafe_tool_calling.dynamic.tool.selection.from.user.input`
- Location: `packages/opencode/src/acp/agent.ts:1577`
- Confidence: 82%
- Recommendation: Use an explicit allowlist of tools and validate tool names server-side before dispatch.
- Evidence: `function toLocations(toolName: string, input: Record<string, any>): { path: string }[] {`

### 16. Dynamic tool selection from user input

- Severity: `high`
- Category: `unsafe_tool_calling`
- Rule: `rule.unsafe_tool_calling.dynamic.tool.selection.from.user.input`
- Location: `packages/opencode/src/session/llm.ts:242`
- Confidence: 82%
- Recommendation: Use an explicit allowlist of tools and validate tool names server-side before dispatch.
- Evidence: `const t = tools[toolName]`

### 17. Dynamic tool selection from user input

- Severity: `high`
- Category: `unsafe_tool_calling`
- Rule: `rule.unsafe_tool_calling.dynamic.tool.selection.from.user.input`
- Location: `packages/opencode/src/session/processor.ts:326`
- Confidence: 82%
- Recommendation: Use an explicit allowlist of tools and validate tool names server-side before dispatch.
- Evidence: `metadata: { tool: value.toolName, input: value.input },`

### 18. Unpinned GitHub Actions detected

- Severity: `high`
- Category: `repo_security_posture`
- Rule: `github-actions.unpinned-actions.grouped`
- Location: `.github/workflows/containers.yml:24`
- Confidence: 82% - Workflow uses non-SHA action refs; 3 third-party, 1 GitHub-owned. Sensitive workflow signals: yes.
- Recommendation: Pin third-party actions to reviewed commit SHAs first, then decide whether GitHub-owned actions also need SHA pinning for your compliance posture.
- Evidence: `4 unpinned action refs: actions/checkout@v4; docker/setup-qemu-action@v3; docker/setup-buildx-action@v3; docker/login-action@v3`

### 19. Unpinned GitHub Actions detected

- Severity: `high`
- Category: `repo_security_posture`
- Rule: `github-actions.unpinned-actions.grouped`
- Location: `.github/workflows/docs-update.yml:21`
- Confidence: 82% - Workflow uses non-SHA action refs; 1 third-party, 1 GitHub-owned. Sensitive workflow signals: yes.
- Recommendation: Pin third-party actions to reviewed commit SHAs first, then decide whether GitHub-owned actions also need SHA pinning for your compliance posture.
- Evidence: `2 unpinned action refs: actions/checkout@v4; sst/opencode/github@latest`

### 20. Unpinned GitHub Actions detected

- Severity: `high`
- Category: `repo_security_posture`
- Rule: `github-actions.unpinned-actions.grouped`
- Location: `.github/workflows/nix-hashes.yml:44`
- Confidence: 82% - Workflow uses non-SHA action refs; 1 third-party, 4 GitHub-owned. Sensitive workflow signals: yes.
- Recommendation: Pin third-party actions to reviewed commit SHAs first, then decide whether GitHub-owned actions also need SHA pinning for your compliance posture.
- Evidence: `5 unpinned action refs: actions/checkout@v6; nixbuild/nix-quick-install-action@v34; actions/upload-artifact@v4; actions/checkout@v4; actions/download-artifact@v4`


## GitHub PR follow-up

**Branch:** `security/review-5aba522a`
**Base:** `dev`

### Low-risk changes applied

- No code files were changed automatically.

### Files changed

- `.github/security-reports/static-analysis-5aba522a-243c-465a-ad62-a48d7a756ae3.md`

### Findings requiring human review

- F-001 Anthropic API key appears to be exposed in github/README.md:120 is review-required; no automatic code change was applied for it.
- F-002 High-risk secret name with assigned value in github/README.md:120 is review-required; no automatic code change was applied for it.
- F-003 Dynamic tool selection from user input in packages/opencode/src/acp/agent.ts:1577 is review-required; no automatic code change was applied for it.
- F-004 Dynamic tool selection from user input in packages/opencode/src/session/llm.ts:242 is review-required; no automatic code change was applied for it.
- F-005 Dynamic tool selection from user input in packages/opencode/src/session/processor.ts:326 is review-required; no automatic code change was applied for it.
- F-006 Server Action performs sensitive work without an obvious auth guard in packages/console/app/src/context/auth.ts:28 is review-required; no automatic code change was applied for it.
- F-007 Server Action performs sensitive work without an obvious auth guard in packages/console/app/src/routes/workspace-picker.tsx:49 is review-required; no automatic code change was applied for it.
- F-008 Server Action performs sensitive work without an obvious auth guard in packages/console/app/src/routes/workspace/[id]/billing/billing-section.tsx:29 is review-required; no automatic code change was applied for it.
- F-009 Server Action performs sensitive work without an obvious auth guard in packages/console/app/src/routes/workspace/[id]/billing/black-section.tsx:141 is review-required; no automatic code change was applied for it.
- F-010 Server Action performs sensitive work without an obvious auth guard in packages/console/app/src/routes/workspace/[id]/billing/monthly-limit-section.tsx:31 is review-required; no automatic code change was applied for it.
- F-011 Server Action performs sensitive work without an obvious auth guard in packages/console/app/src/routes/workspace/[id]/billing/payment-section.tsx:29 is review-required; no automatic code change was applied for it.
- F-012 Server Action performs sensitive work without an obvious auth guard in packages/console/app/src/routes/workspace/[id]/billing/redeem-section.tsx:34 is review-required; no automatic code change was applied for it.

## Review policy

- This pull request does not include speculative code patches.
- Architecture-sensitive findings, including auth, rate limits, agent tools, MCP, CI permissions, and supply-chain posture, remain maintainer-reviewed.
- Local-only report links are intentionally omitted because public maintainers cannot open them.

_Generated from static security analysis._
