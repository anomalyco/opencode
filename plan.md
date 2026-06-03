# Channel System Phase 1 - Implementation Plan

Based on `docs/channel.phase1.md`. Contracts and runtime files already created; remaining work focuses on fixes, barrel exports, service layer, and integration.

## Tasks

### Wave 1 (independent - disjoint files)

- [x] **Task 1: Fix runtime import bugs**
  - `runtime/lifecycle.ts` references `ChannelHealth`/`ChannelCapabilities` without imports
  - `runtime/router.ts` references `MediaPart` without importing it
  - Acceptance: all runtime files import what they use; `bun typecheck` in channels dir passes

- [x] **Task 2: Create contracts barrel export**
  - Create `contracts/index.ts` re-exporting all contract interfaces and types
  - Must re-export: Channel, ChannelHealth, ChannelCapabilities from `./channel`, MessageSender from `./sender`, MessageEditor from `./editor`, TypingCapable from `./typing`, MediaPart + MediaSender from `./media`, ReactionCapable from `./reactions`, StreamingCapable from `./streaming`
  - Acceptance: `import { Channel, MessageSender } from "../contracts"` works

- [x] **Task 3: Create runtime barrel export**
  - Create `runtime/index.ts` re-exporting all runtime modules
  - Must re-export: registry, lifecycle, router, health, capabilities
  - Acceptance: `import { registry, router } from "../runtime"` works

- [x] **Task 4: Update schema.ts for plugin-based system**
  - Make ChannelType support string types (not just `slack`|`discord`) to support plugins
  - Remove `webhook_url` from ChannelInfo (replaced by plugin-specific config)
  - Add optional `config: Schema.Unknown` for plugin-specific configuration
  - Keep backward compatibility where possible
  - Acceptance: schema compiles; ChannelType accepts any string

### Wave 2 (depends on Wave 1 - needs barrel exports to exist)

- [x] **Task 5: Create service layer service/channels.ts**
  - Implement `Interface`, `Service` class, and `layer` per phase1.md spec (lines 372-505)
  - Must follow existing Effect patterns: `Effect.fn`, `Context.Service`, `Layer.effect`
  - Import from existing `channel.sql.ts` (channelTable), `Database`, `Identifier`, `Log`
  - Import router from `../runtime/router`, health from `../runtime/health`, capabilities from `../runtime/capabilities`
  - Do NOT use `Layer.Effected` (doesn't exist) - use `Context.Service` pattern as in existing `index.ts`
  - Do NOT re-define ChannelInfo/CreateChannelInput - import from `../schema`
  - Use self-export pattern at file bottom: `export * as Channels from "."`
  - Acceptance: service layer compiles; provides create/list/remove/send/edit/typing/react/sendMedia/stream/health/capabilities

- [x] **Task 6: Update channels/index.ts to use new service**
  - Replace current webhook-based implementation with re-exports from new service layer
  - Import `Service` and `layer` from `./service/channels`
  - Re-export using `export * as Channels from "./service/channels"` pattern
  - Keep `defaultLayer` export
  - Acceptance: `bun typecheck` passes; all existing imports from channels/index still work

### Wave 3 (integration)

- [x] **Task 7: Run typecheck and fix all issues**
  - Run `bun typecheck` from `packages/opencode`
  - Fix any remaining type errors, import issues, or missing exports
  - Acceptance: `bun typecheck` passes with zero errors in channels files