# Feishu Top-Level Group Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send accepted Feishu group answers as ordinary top-level group messages with a native requester mention instead of thread replies.

**Architecture:** Keep inbound group normalization, deterministic Session routing, durable tasks, retry/recovery, native mention metadata, and exact answer bodies unchanged. Change only the Feishu Channel delivery options so group sends include `mentions` but omit `replyTo` and `replyInThread`, causing the pinned SDK to use its message-create path.

**Tech Stack:** Bun 1.3.14, TypeScript, `@larksuiteoapi/node-sdk@1.71.1`, Bun test, OpenSpec

## Global Constraints

- Group input still requires an explicit robot mention.
- Group output uses the official SDK `mentions` option; never construct mention markup manually.
- Direct-chat output has no requester mention metadata or send options.
- Persisted and sent answer bodies remain byte-for-byte unchanged, including physical `\n` separators.
- Do not change inventory SQL, supplier fallback, shelf aggregation, remarks, SQLite schema, or inbound Session routing.

---

### Task 1: Make group delivery an ordinary top-level message

**Files:**
- Modify: `packages/feishu/test/feishu-channel.test.ts:150-235`
- Modify: `packages/feishu/src/feishu-channel.ts:137-154`

**Interfaces:**
- Consumes: `createFeishuChannelPort(...)`, `GatewayTask.replyMentionID`, `GatewayTask.replyMentionName`, and `FeishuChannelClient.send(to, input, options)`.
- Produces: group `send(...)` calls whose options contain only `mentions`; direct calls continue to pass `undefined`.

- [x] **Step 1: Write the failing Channel tests**

Change the delivered group expectation and native-mention expectations to omit thread options. Use a multi-line body so the same assertion protects exact newline delivery:

```ts
const body =
  "6001ZZ（12×28×8）（货架号：A-2-1）虎旺轴承库存177，备注：2026-07-11\n" +
  "6001ZZ（清油）（12×28×8）（货架号：B-11-13）天宇轴承库存200，备注：2024-7-20"

expect(namedGroup.lastSend).toEqual({
  to: "oc_chat_1",
  input: { text: body },
  options: {
    mentions: [{ key: "ou_user_1", openId: "ou_user_1", name: "求精轴承" }],
  },
})
```

For the generic task without requester metadata, expect `options: undefined`; the named and unnamed group cases above cover native mention options, and the direct-chat case continues to expect `undefined`.

- [x] **Step 2: Run the focused test and verify RED**

Run: `bun test test/feishu-channel.test.ts`

Expected: FAIL because actual group options still contain `replyTo: "om_root_1"` and `replyInThread: true`.

- [x] **Step 3: Implement the minimal delivery change**

In `createFeishuChannelPort(...).send`, build options only from mention metadata:

```ts
const options = {
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

Do not change normalized inbound `replyRootID`; existing stored tasks and Session routing still need it for compatibility and identity.

- [x] **Step 4: Run focused delivery and recovery tests and verify GREEN**

Run: `bun test test/feishu-channel.test.ts test/gateway.test.ts test/worker.test.ts`

Expected: PASS; group send calls have a native mention but no thread options, direct sends have no options, and recovery/retry tests retain exact answer bodies.

### Task 2: Verify, reconcile artifacts, and restart the gateway

**Files:**
- Modify: `openspec/changes/feishu-chat-gateway/tasks.md`
- Verify: `packages/feishu`

**Interfaces:**
- Consumes: the top-level group send behavior from Task 1 and the existing gateway start command.
- Produces: checked OpenSpec tasks, repeatable verification evidence, and a restarted WebSocket gateway.

- [x] **Step 1: Run complete package verification**

Run from `packages/feishu`:

```powershell
bun test
bun typecheck
bun run lint
```

Expected: all non-gated tests pass, the gated live-MySQL contract remains separately verifiable, type checking succeeds, and lint reports zero errors.

- [x] **Step 2: Mark OpenSpec delivery tasks complete and validate**

Check tasks 10.1 and 10.2 after their evidence exists. Run from the repository root:

```powershell
openspec-cn validate feishu-chat-gateway --type change --strict --json
git diff --check
```

Expected: the change is valid with no issues and no whitespace errors.

- [x] **Step 3: Restart only the verified gateway process pair**

Resolve the current gateway Bun process and its direct launcher parent, stop only that exact pair, then start the documented gateway command with hidden-window process hosting. Verify the new Bun child belongs to the new launcher, the WebSocket client reaches ready state, and stderr contains no startup error.

- [x] **Step 4: Complete agent-side final verification**

Check task 10.3 only after restart evidence exists. Re-run the focused Channel test and strict OpenSpec validation.

The remaining manual acceptance is performed in the published Feishu group: sending `6001ZZ @open机器人` must create a standalone bot message in the group timeline, begin with a native requester mention, show no “回复话题”, and render each product on its own line.
