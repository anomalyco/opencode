# Feishu Mention Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every accepted Feishu group-chat reply natively @ the original requester on the same line before the existing inventory answer, while direct-chat replies remain unchanged and supplier/remark values continue to come from each product's actual database data.

**Architecture:** Capture the normalized sender name beside the existing sender open ID, copy group-only mention metadata into the durable gateway task, and add nullable SQLite columns through an additive schema-v2 migration. The official Channel adapter passes that restored metadata through the SDK `mentions` option when sending a group reply; it never inserts mention markup into the persisted answer body. Inventory formatting remains deterministic and unchanged: supplier and remark are emitted only from mapped structured fields, with missing values omitted.

**Tech Stack:** TypeScript, Bun, Bun SQLite, `@larksuiteoapi/node-sdk@1.71.1`, `bun:test`, OpenSpec.

## Global Constraints

- Run tests and `bun typecheck` from `packages/feishu`, never from the repository root and never with `tsc`.
- Use the official Channel client's `mentions` send option; do not manually concatenate `<at>` tags or display names into answer text.
- Add mention metadata only for accepted group-chat messages. Direct-chat tasks and sends have no mention metadata.
- Preserve the current reply target and originating thread/root-message behavior.
- Persist the requester's Feishu open ID and optional observed display name so retries and restart recovery address the original requester.
- Keep `GatewayTask.answer`, message events, and inventory formatter output free of mention markup and requester presentation text.
- Keep the inventory answer body in the approved one-line-per-product format with no internal product code, table, heading, preamble, summary, or follow-up question.
- Supplier and remark are per-item structured database values. Emit the actual supplier and actual remark when present; omit the missing field instead of guessing or substituting a fixed example.
- The representative rendered group reply is `@求精轴承 6001ZZ（12×28×8）（货架号：A-2-1）上海涂众轴承库存177，备注：2026-07-11`; color, shelf, supplier, quantity, and remark vary with actual data.
- Preserve unrelated dirty and untracked files. Stage only the files named by each task.

---

## File Map

- `openspec/changes/feishu-chat-gateway/specs/feishu-message-gateway/spec.md`: specify native group requester mentions and unchanged direct replies.
- `openspec/changes/feishu-chat-gateway/design.md`: record durable mention metadata and presentation/body separation.
- `openspec/changes/feishu-chat-gateway/tasks.md`: add implementation and verification checklist entries for this behavior.
- `packages/feishu/src/migrations.ts`: upgrade the gateway store from schema version 1 to 2 with nullable mention columns.
- `packages/feishu/src/store.ts`: persist, compare, restore, and recover reply mention metadata.
- `packages/feishu/src/feishu-channel.ts`: normalize sender display name and send an SDK-native mention for group tasks.
- `packages/feishu/src/admission.ts`: copy group sender identity into the durable task.
- `packages/feishu/test/store.test.ts`: cover fresh schema, v1 migration, duplicates, and recovered mention fields.
- `packages/feishu/test/feishu-channel.test.ts`: cover normalization and native mention send options.
- `packages/feishu/test/admission.test.ts`: cover group-only mention admission.
- `packages/feishu/test/gateway.test.ts`: cover end-to-end body fidelity and restored mention delivery.

### Task 1: Align the approved OpenSpec artifacts

**Files:**
- Modify: `openspec/changes/feishu-chat-gateway/specs/feishu-message-gateway/spec.md`
- Modify: `openspec/changes/feishu-chat-gateway/design.md`
- Modify: `openspec/changes/feishu-chat-gateway/tasks.md`

- [ ] **Step 1: Add the behavioral requirements**

Extend `Gateway sends one final text reply to the originating conversation` with these scenarios:

```md
#### Scenario: Group reply mentions the requester
- **WHEN** an accepted group-chat task produces a final answer
- **THEN** the gateway uses a native Feishu mention for the original requester before the answer in the originating thread or root-message context

#### Scenario: Direct reply has no requester mention
- **WHEN** an accepted direct-chat task produces a final answer
- **THEN** the gateway sends the answer without requester mention metadata

#### Scenario: Mention presentation does not change the answer body
- **WHEN** a group reply is sent, retried, or recovered after restart
- **THEN** the persisted final answer remains the exact body-only text and the requester mention is applied only by the Feishu delivery adapter
```

In `design.md`, record that `reply_mention_id` and `reply_mention_name` are nullable task delivery metadata, that schema version 2 upgrades version 1 additively, and that the SDK renders the native mention. In `tasks.md`, add unchecked RED/GREEN/recovery/verification items scoped to the files in this plan.

- [ ] **Step 2: Validate the artifacts**

Run from `D:\opencode`:

```powershell
openspec-cn validate feishu-chat-gateway --type change --strict --json
```

Expected: `"valid": true` with no requirement/scenario or artifact consistency errors.

- [ ] **Step 3: Review scope before implementation**

```powershell
git diff -- openspec/changes/feishu-chat-gateway/specs/feishu-message-gateway/spec.md openspec/changes/feishu-chat-gateway/design.md openspec/changes/feishu-chat-gateway/tasks.md
```

Expected: only native requester-mention behavior, direct-chat exclusion, schema-v2 metadata, and verification tasks are added. No inventory answer field or query rule changes.

### Task 2: Persist reply mention metadata with schema version 2

**Files:**
- Modify: `packages/feishu/test/store.test.ts`
- Modify: `packages/feishu/src/migrations.ts`
- Modify: `packages/feishu/src/store.ts`

**Interfaces:**

Extend the durable task boundary:

```ts
export type GatewayTask = {
  // existing fields
  replyTarget: string
  replyRootID?: string
  replyMentionID?: string
  replyMentionName?: string
  // existing fields
}
```

- [ ] **Step 1: Write failing store and migration tests**

Add tests that:

- expect a fresh store to record schema version `2`;
- create a real version-1 SQLite database with an existing task, then call `openGatewayStore` and prove both nullable columns are added without losing the task;
- admit and reload a group task with `replyMentionID: "ou_user_1"` and `replyMentionName: "求精轴承"`;
- close and reopen the database and prove `recoverableTasks()` retains both fields;
- treat reuse of the same external message with a different mention ID or name as `GatewayConflictError`;
- keep direct tasks valid with both fields absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `packages/feishu`:

```powershell
bun test test/store.test.ts
```

Expected: FAIL because the schema is still version 1 and `GatewayTask` has no mention fields.

- [ ] **Step 3: Implement the additive migration and mappings**

Set `currentVersion` to `2`. Include the two columns in the fresh `gateway_task` definition:

```sql
reply_mention_id TEXT,
reply_mention_name TEXT,
```

Inside the existing immediate migration transaction, execute the following only when the previously applied version is `1`:

```sql
ALTER TABLE gateway_task ADD COLUMN reply_mention_id TEXT;
ALTER TABLE gateway_task ADD COLUMN reply_mention_name TEXT;
```

Then update `gateway_schema_version` to `2`. Extend `TaskRow`, the `INSERT`, `mapTask`, and `isExactDuplicate` for both nullable fields. Do not derive, overwrite, or drop mention metadata during a state transition.

- [ ] **Step 4: Run the focused test and verify GREEN**

```powershell
bun test test/store.test.ts
```

Expected: the fresh, v1-upgrade, duplicate, persistence, and recovery cases all pass.

- [ ] **Step 5: Commit the persistence slice**

```powershell
git add packages/feishu/src/migrations.ts packages/feishu/src/store.ts packages/feishu/test/store.test.ts
git commit -m "feat(feishu): persist reply mentions"
```

### Task 3: Retain the group requester's sender identity at admission

**Files:**
- Modify: `packages/feishu/test/feishu-channel.test.ts`
- Modify: `packages/feishu/test/admission.test.ts`
- Modify: `packages/feishu/src/feishu-channel.ts`
- Modify: `packages/feishu/src/admission.ts`

**Interfaces:**

Extend normalized messages with the optional SDK-observed name:

```ts
export type NormalizedFeishuMessage = {
  // existing fields
  senderID: string
  senderName?: string
  // existing fields
}
```

- [ ] **Step 1: Write failing normalization and admission tests**

For a mentioned group fixture with `senderId: "ou_user_1"` and `senderName: "求精轴承"`, expect normalization to preserve both values and admission to store:

```ts
{
  replyMentionID: "ou_user_1",
  replyMentionName: "求精轴承",
}
```

Also prove:

- a group sender with no observed name still stores `replyMentionID` and leaves `replyMentionName` absent;
- a direct message may normalize `senderName` but admission stores neither reply mention field;
- the routing identity still uses `senderID` exactly as before.

- [ ] **Step 2: Run the focused tests and verify RED**

Run from `packages/feishu`:

```powershell
bun test test/feishu-channel.test.ts test/admission.test.ts
```

Expected: FAIL because the normalized and durable message types do not retain the sender display name or group reply metadata.

- [ ] **Step 3: Implement group-only admission**

In `normalizeChannelMessage`, include `senderName` only when the SDK provides a non-empty value. In `createAdmission`, set:

```ts
...(message.chatType === "group"
  ? {
      replyMentionID: message.senderID,
      ...(message.senderName ? { replyMentionName: message.senderName } : {}),
    }
  : {}),
```

Do not infer a display name, use the message text, or add mention metadata for a direct chat.

- [ ] **Step 4: Run the focused tests and verify GREEN**

```powershell
bun test test/feishu-channel.test.ts test/admission.test.ts
```

Expected: normalization and admission tests pass for named group senders, unnamed group senders, and direct chats.

- [ ] **Step 5: Commit the admission slice**

```powershell
git add packages/feishu/src/feishu-channel.ts packages/feishu/src/admission.ts packages/feishu/test/feishu-channel.test.ts packages/feishu/test/admission.test.ts
git commit -m "feat(feishu): retain reply requester"
```

### Task 4: Send the native group mention without changing answer text

**Files:**
- Modify: `packages/feishu/test/feishu-channel.test.ts`
- Modify: `packages/feishu/src/feishu-channel.ts`

**Interfaces:**

Extend the narrow Channel client's send options to match the pinned SDK feature:

```ts
options?: {
  replyTo?: string
  replyInThread?: boolean
  mentions?: Array<{
    key: string
    openId?: string
    userId?: string
    name?: string
    isBot?: boolean
  }>
}
```

- [ ] **Step 1: Write failing send-option tests**

For a group task, call `port.send(task, body)` where:

```ts
const body = "6001ZZ（12×28×8）（货架号：A-2-1）上海涂众轴承库存177，备注：2026-07-11"
```

Expect the fake Channel call to contain the exact unchanged `input.text` plus:

```ts
{
  replyTo: "om_root_1",
  replyInThread: true,
  mentions: [
    {
      key: "ou_user_1",
      openId: "ou_user_1",
      name: "求精轴承",
    },
  ],
}
```

Add cases proving an absent optional name omits `name`, and a direct task sends with no `mentions` option.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
bun test test/feishu-channel.test.ts
```

Expected: FAIL because the current adapter sends only reply-thread options.

- [ ] **Step 3: Implement SDK-native mention delivery**

Build one send-options object from task delivery metadata:

```ts
const options = {
  ...(task.replyRootID ? { replyTo: task.replyRootID, replyInThread: true } : {}),
  ...(task.replyMentionID
    ? {
        mentions: [
          {
            key: task.replyMentionID,
            openId: task.replyMentionID,
            ...(task.replyMentionName ? { name: task.replyMentionName } : {}),
          },
        ],
      }
    : {}),
}
```

Pass `undefined` only when the object has no fields. Continue passing `{ text }` unchanged. The pinned SDK prepends the native `<at user_id="...">...</at>` representation at transport serialization time; application code must not construct that markup.

- [ ] **Step 4: Run the focused test and verify GREEN**

```powershell
bun test test/feishu-channel.test.ts
```

Expected: group replies carry native mention and thread options, direct replies have neither, and the answer string is byte-for-byte unchanged.

- [ ] **Step 5: Commit the delivery slice**

```powershell
git add packages/feishu/src/feishu-channel.ts packages/feishu/test/feishu-channel.test.ts
git commit -m "feat(feishu): mention group requester"
```

### Task 5: Verify end-to-end recovery and actual inventory field behavior

**Files:**
- Modify: `packages/feishu/test/gateway.test.ts`
- Modify only if a failing test identifies a real boundary gap: `packages/feishu/src/worker.ts`
- Modify only if an existing regression is discovered: `packages/feishu/test/inventory-answer.test.ts`

- [ ] **Step 1: Write the end-to-end regression test**

Use a mentioned group message with sender name `求精轴承`, a real temporary gateway store, and a fake Feishu port. Assert:

- the admitted task contains the original group requester's mention ID/name;
- after close/reopen recovery, the task passed to `FeishuPort.send` retains those values;
- `task.answer` and the `text` argument equal only the inventory body and contain neither `@求精轴承` nor `<at`;
- actual supplier and actual remark values remain in their corresponding item line;
- missing supplier or missing remark is omitted for that item rather than filled with an example value;
- multiple products remain one product per line.

- [ ] **Step 2: Run the focused tests and verify RED or regression coverage**

Run from `packages/feishu`:

```powershell
bun test test/gateway.test.ts test/worker.test.ts test/inventory-answer.test.ts
```

Expected before the preceding implementation slices: the recovery mention assertion fails. After Tasks 2–4, all assertions may already pass without a worker or formatter change.

- [ ] **Step 3: Implement only a demonstrated gap**

If mention fields are lost, fix the task handoff at the failing persistence/recovery boundary. Do not prepend the requester in `worker.ts`, do not alter `GatewayTask.answer`, and do not add a fixed supplier or remark in the inventory formatter.

- [ ] **Step 4: Run the focused tests and verify GREEN**

```powershell
bun test test/gateway.test.ts test/worker.test.ts test/inventory-answer.test.ts
```

Expected: recovery delivers the mention metadata separately from the exact body, and all existing inventory-format rules remain green.

- [ ] **Step 5: Commit the end-to-end regression coverage**

```powershell
git add packages/feishu/test/gateway.test.ts
git diff --quiet -- packages/feishu/src/worker.ts packages/feishu/test/inventory-answer.test.ts
if ($LASTEXITCODE -ne 0) {
  git add packages/feishu/src/worker.ts packages/feishu/test/inventory-answer.test.ts
}
git commit -m "test(feishu): verify mention recovery"
```

### Task 6: Full verification, OpenSpec evidence, and live restart

**Files:**
- Modify: `openspec/changes/feishu-chat-gateway/tasks.md`
- No runtime file changes unless verification finds a reproducible defect.

- [ ] **Step 1: Run the complete package verification**

From `packages/feishu`:

```powershell
bun test
bun typecheck
bun run lint
```

Expected: all tests pass except any explicitly documented opt-in contract skip, type checking succeeds, and lint has zero errors or warnings.

- [ ] **Step 2: Validate OpenSpec and the worktree**

From `D:\opencode`:

```powershell
openspec-cn validate feishu-chat-gateway --type change --strict --json
git diff --check
git status --short
```

Expected: the OpenSpec change is valid, whitespace checks pass, and unrelated pre-existing files remain untouched.

- [ ] **Step 3: Mark only verified OpenSpec tasks complete**

Update only the mention-reply task entries added in Task 1. Run the strict validation again and inspect the exact artifact diff.

- [ ] **Step 4: Commit the verified artifacts**

```powershell
git add openspec/changes/feishu-chat-gateway/specs/feishu-message-gateway/spec.md openspec/changes/feishu-chat-gateway/design.md openspec/changes/feishu-chat-gateway/tasks.md
git commit -m "docs(feishu): verify mention replies"
```

- [ ] **Step 5: Restart only the verified gateway**

Stop the currently running gateway and its launcher using their resolved process IDs, then launch:

```powershell
& "C:\Users\Administrator\AppData\Local\OpenCode\FeishuGateway\start-gateway.ps1"
```

Verify the new process remains alive and its sanitized log contains `ws client ready`. Do not print environment secrets.

- [ ] **Step 6: Perform the live Feishu acceptance**

In a group, send a fresh `6001ZZ @open机器人` query. Confirm:

```text
@求精轴承 6001ZZ（12×28×8）（货架号：A-2-1）上海涂众轴承库存177，备注：2026-07-11
```

The UI must render `@求精轴承` as a real native mention; the product fields may differ because shelf, supplier, inventory, and remark must reflect the live database. Then send the same query in a direct chat and confirm the answer has no requester mention. Record pass/fail without copying credentials or raw SDK payloads.

- [ ] **Step 7: Final verification before completion**

Use `superpowers:verification-before-completion` and `openspec-verify-change`. Report completion only after the automated suite, strict OpenSpec validation, process health check, and both live group/direct acceptance cases pass.
