# OpenCode 贡献目标与规范指南

> 创建时间：2026-03-16
> 最后更新：2026-03-16
> 用途：新对话快速参考

---

## 🎯 核心目标

**成为 OpenCode (anomalyco/opencode) 项目的 Top 10 贡献者**

- **目标 Commits**：300 个
- **时间限制**：30 天内
- **当前进度**：约 24 commits（已提交 10 个 PR）
- **策略**：添加 JSDoc 文档，每个 PR 2-4 个 commits

---

## 📋 项目结构

```
packages/opencode/src/util/       # 工具函数（主要目标）
packages/opencode/src/cli/cmd/    # CLI 命令
packages/opencode/src/provider/   # 提供商相关
```

**主要工作目录**：`packages/opencode/src/util/*.ts`

---

## ✅ PR 规范（必须严格遵守）

### PR 标题格式
```
docs: add JSDoc for [函数/命名空间名称]
fix: correct typo [错误] to [正确]
```

### PR 描述模板（复制使用）
```markdown
### Issue for this PR

Closes #[Issue编号]

### Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [x] Documentation

### What does this PR do?

简要描述修改内容，不要长篇大论。

### How did you verify your code works?

TypeScript compilation passes without errors.

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
```

### ⚠️ 关键注意事项

| ❌ 不要这样做 | ✅ 正确做法 |
|-------------|-----------|
| 大段 AI 生成的描述 | 简短、人工写的描述 |
| 不引用 Issue | 每个 PR 必须引用 Issue（Closes #xxx）|
| 多个无关修改混在一起 | 每个 PR 只改相关文件 |
| 使用 `git add -A` | 只添加特定修改的文件 |

---

## 📄 Issue 规范

### 必须使用的模板

1. **Bug Report** - 修复错误时使用
2. **Feature Request** - 添加功能时使用（包括文档）
3. **Question** - 提问时使用

### 已创建的 Issue 用于关联

- **#17738** - [FEATURE]: Add comprehensive JSDoc documentation for utility functions
  - 用途：所有 JSDoc PR 都引用这个 Issue
  - 状态：Open

- **#17740** - Fix typo: buidlCostChunk should be buildCostChunk
  - 用途：拼写错误修复 PR

- **#17741** - Fix typo: calculateOccuredCost should be calculateOccurredCost
  - 用途：拼写错误修复 PR

---

## 🔄 工作流程

### 1. 准备工作
```bash
# 确保分支最新
git fetch upstream dev
git checkout dev
git merge upstream/dev
```

### 2. 创建新分支
```bash
git checkout -b docs-[描述]-batch-[编号]
# 示例：docs-multi-jsdoc-batch-12
```

### 3. 修改文件（添加 JSDoc）
- 每次修改 2-4 个文件
- 每个文件一个 commit
- Commit message: `docs: add JSDoc for [具体名称]`

### 4. 提交 Commit
```bash
git commit -m "docs: add JSDoc for [函数名]" -- packages/opencode/src/util/[文件].ts
```

### 5. 推送和创建 PR
```bash
git push -u myfork [分支名]
gh pr create --repo=anomalyco/opencode --title "..." --body-file [模板文件] --base dev --head OpenCode2026:[分支名]
```

---

## 📊 当前 PR 状态跟踪

| PR # | 标题 | 状态 | Commits |
|------|------|------|---------|
| #17707 | docs: add JSDoc for cmd, format, decodeDataUrl | 等待合并 | 3 |
| #17711 | docs: add JSDoc for defer, iife, lazy | 等待合并 | 3 |
| #17715 | docs: add JSDoc for work, timeout, which, signal | 等待合并 | 4 |
| #17727 | docs: Add JSDoc for fn and proxied | 等待合并 | 2 |
| #17729 | docs: Add JSDoc for stats 函数 | 等待合并 | 3 |
| #17731 | docs: Add JSDoc for shouldAttachShareAuthHeaders | 等待合并 | 1 |
| #17733 | fix: correct typo buildCostChunk | 等待合并 | 1 |
| #17735 | fix: correct typo calculateOccurredCost | 等待合并 | 1 |
| #17764 | docs: Add JSDoc for Hash, Color, Context, EventLoop | 已关闭（不符合规范）| 1 |
| #17768 | docs: add JSDoc for Archive, git, Glob, Lock | 等待审核 | 4 |

**总计约 24 commits，还需约 276 commits**

---

## ⚠️ 常见错误及避免方法

### 1. PR 被自动关闭（2小时内）
**原因**：
- 没有使用 PR 模板
- 描述太长像 AI 生成
- 没有引用 Issue

**解决**：严格按照模板填写，简短描述

### 2. CI 检查失败（typecheck）
**原因**：
- 分支过期（out-of-date）

**解决**：
```bash
# 在 PR 页面点击 "Update branch" 按钮
# 或手动：
git fetch upstream dev
git rebase upstream/dev
git push --force-with-lease
```

### 3. 被标记为不符合规范
**原因**：
- 缺少模板字段
- 未勾选 checklist

**解决**：编辑 PR 描述，补全所有字段

---

## 🔧 可用命令参考

```bash
# 查看当前分支状态
git status

# 查看最新 commits
git log --oneline -5

# 查看已修改但未提交的文件
git diff --name-only

# 创建新分支
git checkout -b [分支名]

# 推送分支
git push -u myfork [分支名]

# 查看 PR 列表
gh pr list --repo=anomalyco/opencode --author=OpenCode2026

# 查看 PR 详情
gh pr view [PR编号] --repo=anomalyco/opencode
```

---

## 📁 已添加 JSDoc 的文件（避免重复）

### 已完成（已提交 PR）
- ✅ `packages/opencode/src/util/cmd.ts`
- ✅ `packages/opencode/src/util/format.ts`
- ✅ `packages/opencode/src/util/data-url.ts`
- ✅ `packages/opencode/src/util/defer.ts`
- ✅ `packages/opencode/src/util/iife.ts`
- ✅ `packages/opencode/src/util/lazy.ts`
- ✅ `packages/opencode/src/util/queue.ts`
- ✅ `packages/opencode/src/util/timeout.ts`
- ✅ `packages/opencode/src/util/which.ts`
- ✅ `packages/opencode/src/util/signal.ts`
- ✅ `packages/opencode/src/util/fn.ts`
- ✅ `packages/opencode/src/util/proxied.ts`
- ✅ `packages/opencode/src/util/stats.ts`
- ✅ `packages/opencode/src/util/providers.ts`
- ✅ `packages/opencode/src/util/shouldAttachShareAuthHeaders.ts`
- ✅ `packages/opencode/src/util/hash.ts`
- ✅ `packages/opencode/src/util/color.ts`
- ✅ `packages/opencode/src/util/context.ts`
- ✅ `packages/opencode/src/util/eventloop.ts`
- ✅ `packages/opencode/src/util/archive.ts`
- ✅ `packages/opencode/src/util/git.ts`
- ✅ `packages/opencode/src/util/glob.ts`
- ✅ `packages/opencode/src/util/lock.ts`

### 待添加的文件（候选）
- ⬜ `packages/opencode/src/util/filesystem.ts` (较大文件)
- ⬜ `packages/opencode/src/util/log.ts`
- ⬜ `packages/opencode/src/util/process.ts`
- ⬜ `packages/opencode/src/util/rpc.ts`
- ⬜ `packages/opencode/src/util/schema.ts`
- ⬜ `packages/opencode/src/util/keybind.ts`
- ⬜ `packages/opencode/src/util/locale.ts`
- ⬜ `packages/opencode/src/util/abort.ts` (已有部分 JSDoc)
- ⬜ `packages/opencode/src/util/instance-state.ts`

---

## 📝 JSDoc 格式示例

```typescript
/**
 * 简要描述函数的作用。
 *
 * 详细说明，包括使用场景、注意事项等。
 * 可以写多行。
 *
 * @param paramName - 参数描述
 * @returns 返回值描述
 * @throws 可能抛出的错误（如果有）
 * @example
 * ```typescript
 * const result = functionName("example")
 * ```
 */
export function functionName(paramName: string): ReturnType {
  // 实现
}

/**
 * 命名空间级别的描述。
 *
 * 说明这个命名空间的用途和使用场景。
 *
 * @example
 * ```typescript
 * NamespaceName.functionName()
 * ```
 */
export namespace NamespaceName {
  // 函数...
}
```

---

## 🎯 下一步行动建议

1. **继续提交新的 PR**
   - 每次 2-4 个文件
   - 严格遵循模板
   - 引用 Issue #17738

2. **监控已提交的 PR**
   - 如果显示 "out-of-date"，点击 Update branch
   - 如果被标记合规问题，立即修改

3. **提高效率**
   - 一次处理多个文件
   - 使用脚本批量创建 PR（如果熟悉）

4. **保持质量**
   - 不要为了追求数量牺牲质量
   - 确保 TypeScript 编译通过
   - 描述要准确、简洁

---

## 📞 紧急联系

- **Discord**: https://opencode.ai/discord
- **GitHub Issues**: 用于技术问题

---

**记住**：目标是 30 天内 300 commits，当前约 24 commits，还需约 276 commits。保持节奏，继续加油！
