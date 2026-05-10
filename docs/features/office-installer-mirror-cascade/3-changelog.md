---
feat-id: office-installer-mirror-cascade
status: done
related: ./3-changelog.md
---

# office-installer-mirror-cascade — changelog

## 一句话

修飞书 / DeskFox 用户点"下载预览插件"撞 `download failed: HTTP 403` 即整个流程死的 bug — 原 `pickFastestMirror` 只返 winner 一个,download GET 失败就 throw 上去。改返排序好的完整 mirror 列表,`startInstall` 内 cascade 任一 mirror 下载挂了自动切下一个,5 个全失败才报错。

> Tiny 规模:1 文件 +64/-32(净 +32 行),0 上游侵入,fork-only 文件内逻辑增强;无 1-spec / 2-plan。

## 触发原因

2026-05-10 user 反馈另一台 Windows 用户机收到 `[Image #1]` 截图:UI 显示"上次安装失败:download failed: HTTP 403"。该用户用的是 fork build 出来的正式 installer(非 dev binary)。

排查路径:
1. **怀疑文件不存在?** WebFetch 5 个镜像目录(清华 / 中科大 / BFSU / 南大 / TDF 官方)→ 全部存在 `LibreOffice_26.2.2_Win_x86-64.msi`(355.5 MiB)。**文件本身不是问题**。
2. **怀疑版本号?** WebFetch `/stable/` 列表 → 26.2.2 / 26.2.3 / 25.8.6 三个版本都在。**版本号选 26.2.2 也没问题**。user 决策不升 26.2.3(没测过)。
3. **真正根因:HEAD probe 通过 ≠ GET 下载通过**。某些镜像因 hotlinking 防盗链 / Referer 检查 / 子镜像分发不一致 / IP 段限速,HEAD 返 200 但 GET 返 403。原 `pickFastestMirror` Promise.any 选完 winner 就死磕一个,挂了无 fallback。

## 实际改动

### `packages/opencode/src/file/office-installer.ts`(+64 / -32)

#### `pickFastestMirror` → `rankMirrors`(语义升级)

**原**:Promise.any 抢 winner,失败才回 first candidate,只返 1 个。
**新**:Promise.all 等所有 probe 结果,活的按延迟升序,死的按原顺序在后,返完整列表。

```ts
async function rankMirrors(): Promise<{ mirror: Mirror; url: string }[]> {
  // ... probe 每个 mirror,分活/死两组 ...
  const alive = results.filter((r) => r.ok).sort((a, b) => a.elapsed - b.elapsed)
  const dead = results.filter((r) => !r.ok)
  return [...alive, ...dead].map(({ mirror, url }) => ({ mirror, url }))
}
```

注:probe phase 总耗时从 `min(probe)` 变成 `max(probe)`(都跑完 ≤ 6s);user 视觉上 "正在选择最快下载源…" 多停 ~2s,换来 cascade 时已知排序,值得。

#### `startInstall` 内置 cascade 循环(`else { ... }` 分支)

```ts
const failures: { mirror: string; err: string }[] = []
let succeeded = false
for (let i = 0; i < ranked.length; i++) {
  const { mirror, url } = ranked[i]
  progress = {
    phase: "downloading",
    mirrorName: mirror.name,
    message: failures.length > 0
      ? `镜像 ${failures[failures.length - 1].mirror} 失败,改用 ${mirror.name}…`
      : undefined,
  }
  try {
    await downloadWithProgress(url, msiPath, mirror.name, (p) => { progress = p })
    succeeded = true
    break
  } catch (e: any) {
    failures.push({ mirror: mirror.name, err: String(e?.message ?? e) })
    await fs.unlink(msiPath + ".part").catch(() => undefined)  // 清残留 .part
  }
}
if (!succeeded) {
  throw new Error(`所有 ${failures.length} 个下载源均失败 — ${failures.map(...).join(" | ")}`)
}
```

UI 反馈:
- **下载中正常**:`progress.mirrorName` = 当前 mirror,UI 显示"镜像源:清华大学"
- **切换瞬间**:`progress.message` = "镜像 清华大学 失败,改用 中国科学技术大学…"(走 office-install-prompt.tsx 的 .message 渲染路径)
- **全失败**:throw 出的 message 进 progress.phase=error,UI 红字显示"上次安装失败:所有 5 个下载源均失败 — 清华大学 download failed: HTTP 403 | 中国科学技术大学 ..."

#### FORK marker

新增 2 处:
- `rankMirrors` 函数头注释块(说明改 winner-only → 完整列表的动机和 hotlinking 场景)
- `startInstall` cascade `FORK-BEGIN`...`FORK-END` 包整个 for 循环 + final throw

## 行数

| 项 | 行数 |
|---|---|
| insertions | 64 |
| deletions | 32 |
| **净** | **+32** |

`<50 净` 阈值内,Tiny。R5 例外清单"Tiny 改动 < 50 行 不强制"适用,延续 `viewer-ctrlc-fix`(36 行)/ `right-click-stale-selection-fix`(30 行)等同级 Tiny bug fix 无测试的先例。

## R4 override 论证(本季第 5 笔,超 ≤ 2 笔/季健康指标 3 笔)

**触发**:`packages/opencode/src/file/office-installer.ts` 在 `.husky/pre-commit` 黑名单内(初版 `66c8fa523` 已 override 进入,后续 `fc69b462c` macOS 适配延续 override,本笔继续延续)。

**配额状况(2026 Q2)**:`66c8fa523` 初版 office / `e2a9d7167` claude-code-loop / `41817499d` plugin-cwd-channel(标"特批不扣下季度")/ `fc69b462c` office-installer-macos / **本笔 office-installer-mirror-cascade** = 5 笔,超 ≤ 2 季度配额 3 笔。下季度补回。

**逐文件 wrapper 不可行性**:

- **`packages/opencode/src/file/office-installer.ts`**:这是 fork 写的"LibreOffice 安装引擎"核心(初版 `66c8fa523` 落地)。要让"选定 mirror 失败 → 切下一个"生效,必须改 `pickFastestMirror` + `startInstall` 内的 download 调用点 — 二者都在该文件内部,且共享 `progress` 模块级状态机。包一个 `office-installer-cascade.ts` 包装器再调原文件:
  - 需要重写 `pickFastestMirror` 返排序列表(原文件返 winner 单个)— 等于复制 + 改一份 = 原文件该函数死代码留着。
  - cascade 循环要触达原 `downloadWithProgress` + 共享 `progress` 全局变量,wrapper 拿不到这俩(后者是闭包内 `let progress`)。
  - 退而求其次"再包一层 module export progress 引用",代价是把 fork-only 文件的内部 state 作为公共 contract 暴露,后续维护负担更大。

  **唯一干净方式 = 在原文件内直接改 `rankMirrors` 语义 + cascade for 循环**(本次做的)。

**风险评估**:

- 行为零回退:winner 优先级未变(alive 列表按延迟升序,first = 原 Promise.any 大概率赢的那个)
- 全部 mirror 都 alive 时:行为等价于"先试最快的,失败试次快的,...";最快通过则与原代码一致
- 全部 mirror 都 dead 时:`rankMirrors` 返 [...empty, ...all dead];cascade 仍尝试所有 5 个(可能 HEAD 探活失败但 GET 成功 — 极少见但有救)
- typecheck 16/16 全过(turbo cache 14 + 新 build 2)
- `progress.message` 切换瞬间字符串走既有 office-install-prompt.tsx 已有渲染(line 203 错误 .message + line 275 mirrorName)— UI 端零改动
- 不影响 macOS 路径:`startInstall` 平台分支(msiexec / hdiutil)在 cascade 之后,此次改动只动 download 阶段,平台 install 部分原样

**改动日志论证**:本笔属"延续之前已 override 进入的 fork-only 文件的小幅增强",和 `fc69b462c`(macOS 适配)同性质。无新文件 / 无新依赖 / 无 schema 改动 / 无上游接触。

## 影响范围

- ✅ Windows:任一镜像 GET 返 403/4xx/5xx 时自动切下一个,直到成功或全失败
- ✅ macOS:cascade 同样生效(download 阶段平台中性,与 macOS DMG / Win MSI 安装分支正交)
- ✅ 缓存复用路径不受影响:已有完整 .msi 文件(>100MB)走 reuse 分支,不进 cascade
- ✅ 错误信息可读性提升:全失败时报"所有 5 个下载源均失败 — 清华大学 X | 中科大 Y | ..."(原代码只报最后一个 mirror 的 status code)
- ⚠️ probing phase 时长从 ~min(probe latency) 变成 ~max(probe latency,≤ 6s);典型国内网络下首个 mirror 几百 ms,等其他 4 个完成 1-3s,user 视觉上多停 1-2 秒
- ⚠️ 部分 .part 残留清理已加(每次失败后 `fs.unlink(msiPath + ".part")`);Bun.file().writer() 也会 truncate,二者双保险

## 回归测试点

**基础设施限制说明**:`office-installer.ts` 无现成单元测试(整个 fork-only 模块从未建测试),且依赖全局 `fetch` + `Bun.file` + `fs` + 模块级 progress state,引入 mock 路径成本远超本次 Tiny 改动本身。延续 R5 Tiny 例外条款 + `viewer-ctrlc-fix`(2026-05-08)/ `right-click-stale-selection-fix`(2026-05-08)等同级 bug fix 先例,本次不补单元测试。

**user 实测点**(下次部署后跑):
- ⏳ R1 happy path:Windows 用户点"下载预览插件" → 正常下完 + 装好(走最快 mirror)→ ✅
- ⏳ R2 模拟 mirror 失败(开 host 把 mirrors.tuna.tsinghua.edu.cn 指 127.0.0.1)→ 应自动切到中科大,UI 显示切换文案 → ✅
- ⏳ R3 全 mirror 失败(断网/全 host 屏蔽)→ 错误信息列出 5 个 mirror 全部失败 → ✅

**已通过**:
- ✅ typecheck 16/16(turbo cache 14 + 新 build opencode/adapter-feishu-lark)

## review 自检

- [x] 仅触动 fork-only 文件(`packages/opencode/src/file/office-installer.ts`)
- [x] FORK marker 加全(rankMirrors 函数头 + cascade FORK-BEGIN/END)
- [x] git diff +64 / -32(净 +32 行,Tiny 阈值内)
- [x] 大小写检查通过(只改既有文件,无新文件)
- [x] 无新增依赖(纯逻辑增强)
- [x] R4 override 三项论证齐(wrapper 不可行 / 风险评估 / 改动日志论证)
- [x] typecheck 全过(16/16)
- [x] 测试豁免:Tiny + 无测试基础设施 + 同级先例
- [x] iron rule 守:① 在 feat/office-installer-mirror-cascade 分支(非直接 dev)② merge dev / push remote 等 user 明确同意
- [x] R5 commit message 加 `[bug-repro: ...]` tag

## 回退方法

```sh
git revert <code commit hash>
```

回退 = 回到 winner-only 模式(原 `pickFastestMirror`),其他所有逻辑不变。无 schema / 无依赖 / 无 UI 协议改动,可干净 revert。

## 备注

- 长期方向:LibreOffice 26.2.3 已发布(2026-04-30)且 5 个镜像都有,user 决策不升级("没测试过");留 backlog 视未来需要再升。
- cascade 失败信息聚合策略:`failures.map(...).join(" | ")` 全列出。极端场景(5 个都长错误)可能字符串很长,UI 会自动换行显示,可读性可接受。
- alive 列表用 `Number.MAX_SAFE_INTEGER` 标 dead 排序键,确保活的永远在死的前面。
