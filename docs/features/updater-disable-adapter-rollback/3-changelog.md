---
feat-id: updater-disable-adapter-rollback
status: done
related: ./3-changelog.md
---

# updater-disable-adapter-rollback — changelog

## 触发

2026-05-03 user 实测 `updater-disable-adapter`(commit `35ed8487a`)出来的 DeskFox.exe,在 Settings → General → Updates 段:
- "立即检查"按钮**可点击**(应灰显 disable)
- 点击后弹 toast **"已是最新版本 / 你正在使用最新版本的 OpenCode"**(应该静默或不响应)

这是真 UX 回归。

## Root cause

adapter 把 `createPlatform` 从"conditional spread + method 不存在"改成"sentinel pattern + method 永远存在内部短路":

```ts
// fork 原来(undefined when off)
...(UPDATER_ENABLED ? { checkUpdate: async () => {...} } : {})

// adapter 改成(always exists, sentinel inside)
checkUpdate: async () => {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  ...
}
```

但 fork 的 frontend 控件依赖 method 存在性来决定 disable:

```tsx
<Button disabled={store.checking || !platform.checkUpdate} onClick={check}>
                              ^^^^^^^^^^^^^^^^^^^^^^^^^^
```

sentinel pattern 让 `platform.checkUpdate` 永远 truthy → `disabled=false` → 按钮可点击 → `check()` 调 `platform.checkUpdate!()` → sentinel 立即返回 `{updateAvailable: false}` → settings-general.tsx 弹"已是最新版本" toast → user 误以为真检查了。

设计错误**不在 sentinel pattern 本身**,而在没看清 fork 原 design 把"backend 短路"和"frontend disable signal"**耦合**在了 method 存在性上。强行解耦 backend(改 sentinel)= 切断 frontend signal。

## 修复

### EDIT `packages/desktop/src/index.tsx`(revert)
- 恢复 `...(UPDATER_ENABLED ? { checkUpdate, update } : {})` conditional spread
- FORK 注释更新:**警告未来不要再换 sentinel pattern**,说明耦合关系
- 注:仍按 fork 原意保留 `update` 旧名 + 旧行为(install only,无 relaunch)

### EDIT `packages/desktop/src/menu.ts`(revert)
- 恢复 `...(UPDATER_ENABLED ? [菜单项] : [])` conditional spread
- 菜单条目在 `UPDATER_ENABLED=false` 时**完全不渲染**(连 disabled 灰也不出现 — 回到原 spec)
- FORK 注释更新

### KEEP `packages/desktop/src-tauri/src/constants.rs` 注释
- 值仍 `UPDATER_ENABLED: bool = false`
- 注释保留之前的更新("backend 总开关,future fork updater 上线翻 true UI 自动亮")
- 这部分注释对未来 fork updater 路径仍然有用,且不影响行为,无须 revert

### EDIT `docs/governance/UPSTREAM-MERGE-GUIDE.md` §4.4
- 在 `UPDATER_ENABLED` 行的"默认建议"列从 "**接上游**" 改成 "**保留 fork**"(2026-05-03 实战翻车)
- §4.4 末加 ⚠️ **教训** 段:"backend 短路"和"frontend disable signal" 耦合时,改 method 暴露策略会破坏 UI 信号 + 给出判断准则:**改 prep 前先 grep `disabled={!platform.<method>}` 类 callsite**

## 验证

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --force`(全 monorepo,无缓存) | **15/15 successful** |
| `build-deskfox.ps1 -Env dev -NoBundle` 端到端 release build | **DeskFox.exe ready**(123s) |
| Settings → Updates 段 "立即检查"按钮恢复灰显不可点 + 不再弹假 toast | 待 user 自验 |
| Settings → Updates 段 "启动时检查更新" / "发行说明" 开关恢复灰显 | 待 user 自验 |
| mac 顶部菜单 "Check for Updates..." 不渲染(连灰也无) | 待 user 自验(mac 端) |

## 影响范围

### 撤回收益
- 恢复 `禁自动升级`(2026-04-28 commit `592ed714e`)的原 UX 设计:UI 入口控件灰显或隐藏,不发任何 toast,无误导
- 未来 fork updater 路径不变:翻 `UPDATER_ENABLED=true` → spread 自动恢复 method → controls 自动 enable

### 沉淀
- UPSTREAM-MERGE-GUIDE §4.4 加教训段,future agent / future-self 看到 "adapter prep" 提案时**先 grep 多重信号** —— 防再撞同类坑
- `updater-disable-adapter` 原 commit (`35ed8487a`) 不删,作为反面教材;commit history 自然反映"做错了再退回"的过程,比硬 revert 更有教育意义

### 未追加
- **没动 cli.rs**(`OPENCODE_DISABLE_AUTOUPDATE` env)— 跟本 UX bug 无关
- **没动 app callers / Platform type / electron** — 这些上次根本就没改

## 当前 sync prep 累计成果

|  | commit | 净改动 | 状态 |
|---|---|---|---|
| ① zod-schema-bridge | `b8636882c` | ~25 行 + 1 文件 | ✅ 落地不动 |
| ② updater-disable-adapter | `35ed8487a` | ~34 行 | ⚠️ rollback(本笔) |
| ② updater-disable-adapter rollback | (本笔) | ~12 行 + governance 教训 | ✅ |

② 路径净结果:仅 constants.rs 注释更新 + governance 教训沉淀。createPlatform / menu 回 fork 原 design。下次 sync upstream 时这个 surface 仍按 §4.4 类型 4 处理(保留 fork,~10 行机械冲突)。

## 教训

- **adapter prep 改前 grep multiple-signal callsite**:`disabled={!platform.<method>}`,`if (!platform.<method>)`,`platform.<method> && ...` 等,任意一个匹配都说明 method 存在性承担 frontend signal 责任,不能轻率 sentinel 化
- **build verify ≠ UX verify**:typecheck + build 通过不代表 UX 没回归。涉及 user-visible 控件状态变化,必须 user 实测
- **R1 三级跳"完全在新文件做"** 的诚实评估:这次 prep 的本意是"减 merge 冲突",但实际是"为了对齐上游 pattern" — 当对齐上游会破坏 fork 既有 UX 时,**坚持 fork 路线** 才是正解,不必为了"永久 0 冲突"扯垮 UX

## R4 override

无。

## 回退方法

如果发现本 rollback 有新问题:
1. `git revert` 本笔 commit → 回到 sentinel pattern 状态
2. 或重新设计 fork-side UI gate 方案(用 `window.__OPENCODE__?.updaterEnabled` 直接 gate,跟 backend method 解耦)

无 lock-in。
