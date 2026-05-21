---
feat-id: abandon-cloud-build-workflows
status: done
related: ./3-changelog.md
---

# abandon-cloud-build-workflows — changelog

**关联 commit**: `<本笔 commit>`
**所在分支**: `feat/abandon-cloud-build-workflows`
**规模**: Tiny+(治理决策定型,4 文件 / ~80 行净改)
**触发**: 2026-05-21 跑完首次 Tier 2 ship 后,review 剩余 follow-up(`release-deskfox.yml` Tier 2 自动化 / `release-mirror-gitee-deskfox.yml` 复活)→ user 拍板**不再用云端 build,所有 ship 走本地**

## 决策

**3 个 release workflow yml 永久废止**(不再恢复):

| Workflow | 历史状态 | 新状态 |
|---|---|---|
| `release-deskfox.yml`(Win)| 2026-05-11 DISABLED(`bun run build --single` 在 GH Actions Win runner 撞 sidecar deadlock,挂账"根因待 dig")| 2026-05-21 OFFICIALLY ABANDONED |
| `release-mac-deskfox.yml`(Mac)| 2026-05-11 一并 DISABLED(跟 Win 统一策略)| 2026-05-21 OFFICIALLY ABANDONED |
| `release-mirror-gitee-deskfox.yml` | 2026-05-11 DISABLED(silent fail + Win release-deskfox.yml 已废)| 2026-05-21 OFFICIALLY ABANDONED |

## 决策依据

1. **deadlock 半月未 dig 出来**:2026-05-11 挂账,产出 unknown,user 时间精力有限
2. **本地 ship 流程已实战跑顺**:多次 Tier 1 prod ship + 首次 Tier 2 dev ship(2026-05-21 当天)全部本地路径成功
3. **维持云端 CI 的边际成本超过收益**:GitHub Actions runner 出 installer 跟本地速度差不多(本地 ~3-5 min,cloud ~10-15 min),本地还少一层网络层 / cache 失效风险
4. **Gitee mirror workflow 双重 silent fail 历史**:5.5.1 / 5.9.1 两次 GH 显示 success 但 Gitee 实际没建 release,根因模糊,本地 API 调用反而稳定可控
5. **deadlock dig 投资回报低**:即使解了 deadlock,本地流程已经够用,云端只是 nice-to-have

## 实际改动

### 3 个 workflow yml 头注全面重写

`release-deskfox.yml` / `release-mac-deskfox.yml` / `release-mirror-gitee-deskfox.yml`:
- "🚧 2026-05-11 DISABLED" 改 "🚫 OFFICIALLY ABANDONED 2026-05-21"
- 移除"复活方式"段(已永久废止)
- 加 user 拍板理由 + 唯一 ship 流程指引(指向治理 doc §五)
- 加保留 yml 作历史快照的理由(build job 逻辑 / Rust cache / Gitee API 调用片段有参考价值)
- `on:` 块继续保持 dispatch-only + abandoned-notice,user GH UI 不会误触发

### 治理 doc `版本号与发布渠道规范.md`

§四 Tier 1 / Tier 2 表:
- "自动化 workflow" 行改成 "Ship 路径" 行,明示"本地 pack + 手动 gh release + 手动 mirror"
- "GitHub Release latest / prerelease 标 + Gitee Release(自动镜像)"改"(本地脚本镜像)"

§五 操作 SOP:
- 顶部加 2026-05-21 全本地化决议提示
- 5.1 Tier 1 / 5.2 Tier 2 完整重写命令链(本地 pack → commit bump → push tag → gh release create [--prerelease] → Gitee API POST → mirror-asset-to-gitee.ps1)

§六 决策记录加新一行(2026-05-21 ship 流程全本地化)。

§七 follow-up:
- 撤掉 "Tier 2 自动化 workflow" 一项
- 撤掉 "Gitee mirror 复活" 一项
- 保留 "官网'预览版'入口"(单独事,跟仓库分离)

## 行数

| 项 | 行数 |
|---|---|
| 3 个 workflow yml 头注重写 | +60 / -25 |
| 治理 doc §四 / §五 / §六 / §七 | +35 / -15 |
| INDEX + 改动日志索引 | +2 |
| **净** | **~+97 / -40 = 57 净** |

Tiny+ 治理决策(单一主题:废止云端 build)。

## R 合规

- **R2** 不需要 FORK marker(workflow yml + 治理 doc 全 fork-only 文件)
- **R3** 不涉及品牌
- **R4** 0 override(全 fork-only)
- **R5** 治理决策,无代码改动,无 unit test 需求
- **R6** 不涉及网络监听

## 回退

如果未来真要恢复 cloud build:
```
git revert <本笔 commit>
```
然后 dig `bun run build --single` 在 GH Actions Win runner 上的 sidecar deadlock 根因。但治理决策方面,**已永久废止**这条路径,除非有强 backing 理由(团队扩大 / 远程协作 ship 需求)否则不复活。

## 关联

- **直接前置**:`installer-naming-cleanup` + `ship-scripts-naming-fix` + `win-ship-dev-2026.5.21.1-dev`(首次 Tier 2 ship 实战验证本地流程跑顺,触发本笔决策)
- **基石依赖**:[`3tier-versioning-governance`](../3tier-versioning-governance/3-changelog.md)(3-tier 体系治理 doc 主体)
- **历史**:2026-05-11 `release-deskfox.yml` 首次 DISABLED 时挂账"根因待 dig",2026-05-21 决议放弃 dig
