---
feat-id: dev-typecheck-fix
status: done
related: ./3-changelog.md
---

# dev-typecheck-fix — changelog

## 现象

2026-05-03 在 dev 上跑 `bun run typecheck`(等价 `cd packages/opencode && tsgo --noEmit`),爆 **555 个 TS 错**。错误类型分布:

| TS code | 数量 | 性质 |
|---|---|---|
| TS2345 | 252 | `Layer<X, any, any>` 不能赋给 `Layer<X, any, never>` |
| TS2488 | 81 | `Type 'never' must have a '[Symbol.iterator]()'` |
| TS2339 | 73 | property 不存在 |
| TS2322 | 73 | type 不可赋值 |
| TS18046 | 37 | `'X' is of type 'unknown'` |
| 其他 | 39 | TS2769 / TS7006 / TS2719 等 |

错误覆盖 **34 个 src 文件 + 50+ test 文件**,其中 `src/effect/app-runtime.ts` 和 `bootstrap-runtime.ts` 是中心节点(它们是全 codebase Effect runtime 入口)。

## 根因诊断

排查路径:

1. **第一假设**:dev 自身代码 bug —— 但 dev `git log` 上最近无 effect 相关 commit,假设不成立
2. **第二假设**:tsgo native-preview 编译器跟 Effect 库不兼容 —— 用 `./node_modules/.bin/tsc --noEmit -p .`(标准 TS 编译器)对比跑,**0 错** + warning:
   ```
   warning TS6: Package effect is referenced multiple times with different versions (4.0.0-beta.48, 4.0.0-beta.57)
   ```
3. **真正根因**:`effect` 包在 `node_modules` 物理上**装了两份**(.48 + .57),`@effect/platform-node` / `@effect/platform-node-shared` 同样两份。同一份 codebase 被 TS 看到两个不同版本的 Effect type 定义,所以 `Layer<X, any, never>`(版本 A)跟 `Layer<X, any, any>`(版本 B)互不识别 → 555 个类型不匹配错全部源于此。

排查命令:

```bash
ls node_modules/.bun/ | grep -i "^effect@"
# effect@4.0.0-beta.48
# effect@4.0.0-beta.57

ls -la packages/opencode/node_modules/effect packages/shared/node_modules/effect
# packages/opencode/node_modules/effect -> .../effect@4.0.0-beta.57/...
# packages/shared/node_modules/effect   -> .../effect@4.0.0-beta.48/...
```

## 根因背后的故事

时间线还原:

| 时间 | 事件 |
|---|---|
| 2026-05-02 | sync/upstream-2026-05-02 分支上,catalog 临时升过 `effect: 4.0.0-beta.48 → .57`(跟 upstream merge 同步);`bun install` 把 node_modules symlinks 重新指向 .57 |
| 2026-05-02 当晚 | merge 出现语义冲突,选 full abort —— `git merge --abort` + 切回 dev,git checkout 把 `package.json` catalog **还原为 .48** |
| ... | **但 `node_modules/` 物理状态完全没动** —— 上次 install 留下的 symlinks(指向 .57)依然在;`shared/node_modules/effect` 因为是 4-23 老的链接所以保留指向 .48 |
| 2026-05-03 sync 工作前置任务 | 跑 typecheck 想确认 dev 干净,爆 555 错 |

**陷阱本质**:`git checkout` / `git reset` **不会**回滚 `node_modules` 状态。bun.lock 内容回到 .48,但物理 symlinks 还指 .57 → 静默撕裂。

## 修复

```bash
bun install   # bun 检测到 lock 跟 symlinks 不一致,重新 reconcile
```

输出 `Saved lockfile / Checked 2439 installs across 2708 packages (no changes) [15.46s]`,看似 "no changes" 但 symlinks 已经悄悄重指 .48。

```bash
ls -la packages/opencode/node_modules/effect
# packages/opencode/node_modules/effect -> .../effect@4.0.0-beta.48/...   ✅
```

验证:

```bash
cd packages/opencode && bun run typecheck   # 0 错
cd /d/project/opencode-fork && bun turbo typecheck --force   # 15/15 successful
```

## 改动清单

**0 行代码**。只动了 governance 文档:

- `docs/governance/UPSTREAM-MERGE-GUIDE.md`
  - §5.0 加 `bun install` 作为 merge 后(及 abort 后)第一步
  - §7 常见踩坑加一行:`merge --abort` 后 typecheck 突然几百错 / 根因 / `bun install` 修
  - TL;DR 第 5 条同步加 "**或 abort 后**" 字眼
- `docs/features/dev-typecheck-fix/3-changelog.md`(本文档)
- `docs/features/INDEX.md`(加索引行)
- `本仓 改动日志.md`(加索引行)

## 影响范围

- **dev typecheck 健康**:已恢复 0 错 / 15 模块全绿,可以在干净状态下叠下游 prep feature(zod-schema-bridge / updater-disable-adapter)
- **未来 sync 工作**:abort merge 后必跑 `bun install`,playbook 已固化到 §5 / §7 / TL;DR,future agent 翻文档就能避坑
- **ci 影响**:0 行代码改 → 不触发任何流水线行为变化

## 为什么这是 Tiny / 没有 spec / plan

- 没有产品需求,纯环境诊断
- 改动只在 governance 文档,无代码
- 但**值得留 changelog**:诊断过程(tsc vs tsgo 对比 → 找到 duplicate package warning → ls -la symlinks)是未来撞到同类问题的关键路径,直接读 changelog 比从零再 dig 一遍快十倍

## R4 override

无。

## 回退方法

无须回退。文档纯增量,删掉本目录 + 还原 UPSTREAM-MERGE-GUIDE.md / INDEX.md / 改动日志.md 三处即可。
