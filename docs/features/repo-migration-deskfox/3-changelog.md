---
feat-id: repo-migration-deskfox
status: done
related: ./3-changelog.md
---

# repo-migration-deskfox — changelog

> **2026-05-04 增补**:user 在主仓迁移完成后将 GitHub 用户名 `yuesoue` 改名为 `zoulukuang`(对齐 Gitee 用户名),详见 [`user-rename-zoulukuang/3-changelog.md`](../user-rename-zoulukuang/3-changelog.md)。本文档保留迁移当时的 username `yuesoue` 不动 —— 历史叙述准确性优先于"现状一致";现在的真实仓库地址是 `github.com/zoulukuang/deskfox`。

## 触发

2026-05-03 上游 PR 工作时撞墙:`yuesoue/opencode-for-office-deskfox` 在 GitHub 上 `isFork: false, parent: null` —— 不是 GitHub 意义上的 fork(当年是 clone+rename+push,没经过 fork 按钮)。`gh pr create` 跨仓需要 fork 关系,直接撞死。

派生问题:
- 品牌诚信瑕疵 — 看起来像 "独立项目恰好同源" 而非 "合法 derivative"
- 上游 dev 看不到 DeskFox 是 derivative,潜在贡献者发现性低
- 每次贡献都要绕 fork 关系问题(摩擦 → 少贡献)

按"对 DeskFox 长期发展有利"原则,**主仓彻底迁到 yuesoue/deskfox**(真 fork)。

## 决策路径(完整决策见对话记录)

### 候选方案对比

| 方案 | 描述 | 评价 |
|---|---|---|
| Z(stub fork)| 新建 yuesoue/opencode 之类只放 PR 分支,主仓不变 | 摩擦只解一半,2 个仓维护 |
| Y(删老仓重 fork 同名)| 删 yuesoue/opencode-for-office-deskfox 然后 fork 用同名 | 丢 Releases / Stars / Issues,GitHub 看到删仓信号差 |
| **本笔(新仓新名)** | 新建 yuesoue/deskfox 真 fork,主仓迁过去,老仓 archive | 0 损失(老仓保留)+ 品牌干净 + 真 fork 关系 |

### 名字选择

`yuesoue/deskfox` 优于 `yuesoue/opencode-for-office-deskfox`:
- **OSS 行业惯例**:产品名 = repo 名(microsoft/vscode / vercel/next.js / gatsbyjs/gatsby)
- **解耦上游品牌变迁**:上游已经发生过 sst → anomalyco rename,以后还会变
- **provenance 在 GitHub fork link**(自动显示 "forked from anomalyco/opencode")+ README 一句话即可,不需要塞仓名
- 短、shareable、易记

### user 改名暂缓

考虑过 `yuesoue → xiaonan-yue` rename 一并做,但:
- 24 小时冷却期 + 释出后他人可注册 yuesoue 抢去做 impersonation
- 用户名改名 + 主仓迁移本质同一个 feature,但两件事的耦合带来风险叠加
- 决定:**只做主仓迁,user 改名留改天**

## 操作执行

### Phase 1 — 建仓 + push 内容

1. `gh repo fork anomalyco/opencode --fork-name=deskfox --clone=false`
   → 新建 `yuesoue/deskfox`,GitHub 自动设 `parent = anomalyco/opencode`(`isFork: true`)
2. 加 git remote `deskfox-fork` → 指 yuesoue/deskfox
3. `git push --force-with-lease deskfox-fork dev`
   → 把我们 dev(`080482d9b`)force-replace yuesoue/deskfox 上的 dev(原本是上游 dev `8299fb3e2`,刚 fork 无人依赖,force 安全)
4. `git push --tags deskfox-fork`
   → 推全部本地 tag(包含 `ship-prod-2026.5.3.1` 等所有 fork-only release tags;上游已有的 tag git 自动跳过)

### Phase 2 — 切本地远端

5. `git remote rename origin origin-legacy`(老 origin 保住,以后还要 sync 几个东西过来)
6. `git remote rename deskfox-fork origin`
7. `git branch --set-upstream-to=origin/dev dev`(本地 dev tracking 切到新)

### Phase 3 — docs URL 更新

更新当前活跃引用(历史 release URL 留作历史事实不动):

| 文件 | 改动 |
|---|---|
| `docs/legal/{PRIVACY.md,隐私协议.md}` | GitHub URL 改 `yuesoue/deskfox`(Gitee URL 暂留 `zoulukuang/opencode-for-office-deskfox`,Gitee 侧待迁) |
| `docs/installer-versions.md` | release 链接改新仓 |
| `改动日志.md` 仓库基线信息段 | origin 描述改新仓,加 origin-legacy 行,gitee 行加 "待 Gitee 侧手动新建 zoulukuang/deskfox + auto-sync from yuesoue/deskfox" 注 |
| `docs/{design,requirements,workflow}-telemetry-and-update.md` | 标题 `opencode-for-office-deskfox` → `DeskFox`(收紧) |

### Phase 4 — 老仓 deprecation

在 `chore/deprecate-old-repo-readme` 临时分支编辑 README(顶部加 deprecation banner 指向新仓),force-push 到 origin-legacy:dev,本地分支即删。**老仓 dev 多 1 commit,无害**。

### Phase 5 — 不在本笔做(留 backlog)

- **Mac 端 git remote 切换**:Mac 协作端要跑 `git remote set-url origin https://github.com/yuesoue/deskfox.git`(出文字命令 / 跟用户协调)
- **Gitee 镜像迁移**:Gitee 侧手动新建 `zoulukuang/deskfox` + 配 auto-sync from `yuesoue/deskfox`(GitHub 不能代操作 Gitee)
- **老仓 archive**:✅ **2026-05-04 done** — `gh api repos/zoulukuang/opencode-for-office-deskfox -X PATCH -f archived=true`,验证 `isArchived: true`。老仓变 read-only,deprecation banner 不动,redirect 不影响,历史 release(`ship-prod-2026.5.1.2` 等)仍可访问。提前于"几周后"完成,因新仓两天稳定通过 3 笔 release 全链路实测(Win + Mac + Gitee 镜像 + README 重塑 + social preview),0 stars/forks/watchers 受影响,无理由再等
- **CI 状态校验**:看 push tag 时是否在新仓自动触发了 release-deskfox.yml(可能造成 ship-prod-2026.5.3.1 被新仓 CI 重复 build → 出第二个 draft Release),若有需手动 cancel
- **README 替换**:目前新仓 README 还是上游 OpenCode README,以后做 DeskFox 自家 README(不阻塞)

## 验证

| 项 | 状态 |
|---|---|
| `yuesoue/deskfox` 创建 | ✅(`isFork: true, parent: anomalyco/opencode`)|
| dev `080482d9b` push 到 yuesoue/deskfox | ✅ |
| 全部 tag(含 `ship-prod-*`) push | ✅ |
| 本地 origin 切换(origin → 新仓,老仓改名 origin-legacy) | ✅ |
| docs 4 处活跃 GitHub URL 引用更新 | ✅ |
| 3 个 telemetry doc 标题收紧到 "DeskFox" | ✅ |
| 老仓 dev 加 deprecation banner | ✅ |
| 上游 PR(2 笔) + Issue(4 笔) | ✅(早些时候已 push 到 yuesoue/deskfox 提交,gh PR/issue 都在线)|

## 影响范围

### 直接收益
- GitHub fork 关系修复 — yuesoue/deskfox 是 anomalyco/opencode 的真 fork
- 上游 PR 工作流不再撞墙 — 任何 fork 想提的内容直接走 gh CLI
- 品牌诚信修复 — derivative lineage 显性化
- repo 名 = 产品名,跟 OSS 行业惯例对齐

### 长期
- 跟上游品牌变迁解耦(以后上游再 rename 也不影响 yuesoue/deskfox 名)
- 鼓励持续向上游贡献(摩擦消除 → 频率上去 → 上游看见 DeskFox 受其工作影响 → 心理上照顾 DeskFox 用例)

### 风险
- 老仓 URL 在外部引用过的(blog / wiki / 本地 bookmark)会断 — 但 GitHub 一般保留 redirect 一段时间
- Gitee 镜像未迁,`gitee.com/zoulukuang/opencode-for-office-deskfox` 仍同步老 GitHub 仓直到 Gitee 侧操作
- Mac 协作端在切 origin 前 push 会推到老仓,需协调

## R4 override

无(全在 fork 治理白名单 + docs 内)。

## 关联

- 触发上下文:对话 2026-05-03 上游 PR 撞 fork 关系问题
- 相关 backlog:
  - **Mac 端 origin 切换**:协调命令 `git remote set-url origin https://github.com/yuesoue/deskfox.git`
  - **Gitee 镜像迁移**:Gitee 侧手动操作
  - **CI 状态校验**:看新仓是否触发重复 release build
  - **老仓 archive**:✅ 2026-05-04 done(详见 Phase 5)
  - **新仓 README 替换为 DeskFox 自家版本**:不阻塞
  - **user 改名 yuesoue → xiaonan-yue**:暂缓,改天独立 feat
