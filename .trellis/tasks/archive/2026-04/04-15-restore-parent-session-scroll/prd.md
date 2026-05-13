# Restore Parent Session Scroll Position

## Goal

当用户从子智能体会话返回父会话时，恢复到离开前的滚动位置，而不是跳到会话底部。

## Problem

**当前行为**：
1. 用户在主会话中滚动到某个位置（例如查看历史消息）
2. 点击进入子智能体会话
3. 在子智能体会话中工作
4. 点击返回按钮回到父会话
5. **问题**：滚动位置跳到底部，而不是之前的位置

**根本原因**：
- `use-session-hash-scroll.ts` 中，每次 `sessionKey` 变化时设置 `fresh = true`
- 如果 URL 没有 hash 且 `fresh = true`，会强制滚动到底部
- 主 session timeline 没有使用项目现有的 `createScrollPersistence()` 机制来持久化滚动位置

## Requirements

### 1. 保存滚动位置
- 当用户离开会话时（导航到子会话），保存当前主 timeline 的滚动位置
- 使用项目现有的 `createScrollPersistence()` 机制或类似模式
- 滚动位置应该按 sessionKey 维度存储

### 2. 恢复滚动位置
- 当用户返回会话时，检查是否有保存的滚动位置
- 如果有保存的位置，恢复到该位置
- 如果没有保存的位置（首次访问），保持现有行为（滚动到底部）

### 3. 不影响现有行为
- 首次打开会话：滚动到底部（live 模式）
- 创建新会话：滚动到底部
- URL 带 hash（消息锚点）：滚动到对应消息
- 在同一会话内的滚动和导航：保持现有行为

### 4. 使用现有模式
- 参考 `review-tab.tsx`、`file-tabs.tsx` 的滚动恢复模式
- 使用 rAF 延迟恢复，避免 DOM 尚未稳定
- 区分用户滚动和程序性滚动

## Acceptance Criteria

- [ ] 从子会话返回父会话时，滚动位置恢复到离开前的位置
- [ ] 首次打开会话时，仍然滚动到底部
- [ ] URL 带 hash 时，仍然滚动到对应消息
- [ ] 不影响 auto-scroll 和 live 模式的行为
- [ ] 代码遵循 frontend hook guidelines
- [ ] 通过 lint 和 typecheck
- [ ] 手动测试通过：
  - 在主会话中滚动到中间位置
  - 进入子会话
  - 返回主会话
  - 验证滚动位置恢复

## Technical Notes

### 现有机制

**`createScrollPersistence()`** (`packages/app/src/context/layout-scroll.ts`)：
- 提供 `scroll(sessionKey, tab)` 和 `setScroll(sessionKey, tab, pos)`
- 通过 debounce flush 到 `store.sessionView[sessionKey].scroll`
- 这是项目标准的按会话维度保存/恢复滚动位置的模式

**主 session timeline** (`packages/app/src/pages/session.tsx`)：
- 使用 `createAutoScroll()` 管理自动滚动
- Line 1270-1290: 初始化时强制滚动到底部
- 需要集成滚动位置保存/恢复逻辑

### 实现思路

1. **在 `session.tsx` 中集成滚动持久化**：
   - 使用 `view().setScroll("timeline", {x, y})` 保存滚动位置
   - 在适当时机调用 `view().scroll("timeline")` 恢复位置

2. **修改初始化逻辑**：
   - 在 Line 1270-1290 的初始化逻辑中，检查是否有保存的滚动位置
   - 如果有，恢复到该位置而不是滚动到底部
   - 如果没有，保持现有行为

3. **使用 rAF 延迟恢复**：
   - 参考 `review-tab.tsx` 的 `queueRestore()` 模式
   - 确保 DOM 稳定后再恢复滚动位置

4. **区分场景**：
   - 首次访问（没有保存的位置）→ 滚动到底部
   - 返回访问（有保存的位置）→ 恢复位置
   - URL 带 hash → 优先处理 hash 导航

### 需要修改的文件

1. **`packages/app/src/pages/session.tsx`** - 主要修改
   - 集成滚动位置保存/恢复逻辑
   - 修改初始化行为

2. **可能需要修改**：
   - `packages/app/src/pages/session/use-session-hash-scroll.ts` - 如果需要调整 hash 导航逻辑
   - `packages/app/src/context/layout.tsx` - 如果需要扩展状态结构

## References

- Research Agent 分析：详细的代码模式和现有机制分析
- 相关 spec：
  - `.trellis/spec/frontend/hook-guidelines.md`
  - `.trellis/spec/frontend/state-management.md`
- 代码示例：
  - `packages/app/src/context/layout-scroll.ts` - createScrollPersistence
  - `packages/app/src/pages/session/review-tab.tsx` - rAF 延迟恢复
  - `packages/app/src/pages/session/file-tabs.tsx` - tab 滚动恢复
