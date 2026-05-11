---
feat-id: mac-pack-installer-and-gitee-rename
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# mac-pack-installer-and-gitee-rename — plan

## 顺序

```
Phase 1: 开 feat 分支 + 本地 rename .dmg
Phase 2: 删 Gitee 老仓 release + 新仓创 release + 上传 .dmg
Phase 3: GitHub release asset 重传新名
Phase 4: 改 git remote gitee URL
Phase 5: 改 legal docs Gitee URL(zh/en 各 3 处)
Phase 6: 改 memory(reference_push_remotes + MEMORY.md)
Phase 7: docs 三文档 + INDEX + 改动日志
Phase 8: commit + push + 验证
```

## 决策轨迹

### 1. pack-installer.sh 已存在,不重写

发现 `packages/branding/scripts/pack-installer.sh` 早期已落地(line 73-94 rename 逻辑正确),5.11.1 ship 时误绕过用 `build-deskfox.sh -Env prod` 直接 build。**结论**:不重写脚本,文档化它作为 SOP 入口。

### 2. release 迁移路径选择

Gitee 老仓 5.11.1 release 处理两选项:

| 选项 | 操作 | 优缺点 |
|---|---|---|
| A. 留老仓不动,只新仓建 | release 双仓共存 | ❌ 维护两份 / user 困惑哪个新 |
| **B. 删老仓 release + 新仓重建** | release 单仓 | ✅ 干净 / 跟 git remote 切新仓对齐 |

选 B。老仓即将被 deprecate(类比 GitHub 老仓 2026-05-04 archive 路径),release 留着只增加混乱。

### 3. Gitee 改名影响范围 — 改动 vs 历史不改

| 文件类型 | 处理 |
|---|---|
| **legal docs(用户可见)** | 改 — `PRIVACY.md` + `隐私协议.md` 用户随时点开,URL 必须 current |
| **memory(私密,自用)** | 改 — `reference_push_remotes.md` + `MEMORY.md` 是 agent 下次工作引用,必须 current |
| **本机 git remote** | 改 — 必走新仓 |
| **历史 feat changelog**(repo-migration-deskfox / user-rename-zoulukuang / release-自动化 / macos-打包) | **不改** — 写的是当时事实,改了失真 |
| **改动日志.md 早期段** | **不改** — 同上 |
| **历史 docs/installer-versions.md 早期 entry** | **不改** — 同上 |

### 4. 同笔 feat 处理两件事(pack-installer SOP + Gitee 改名)

理由:都涉及 Mac ship 流程闭环,时间上同期(5.11.1 ship 修补 + Gitee 改名生效是同一笔触发),拆两个 feat docs 没必要。commit 可以分笔(rename 修补 / 改 remote / 改 docs)。

### 5. ship 工件不写文档,只 commit docs 变化

GitHub + Gitee release 重传是**远端动作**,不是 git 改动 — 不需要 commit。本 feat 落 git 的部分:
- legal docs 改 Gitee URL
- memory 改(项目外,不入 git)
- 三文档落盘 + INDEX + 改动日志

## 不做

- `mirror-asset-to-gitee.ps1`(Win)同步检查 — Win 端默认就是 `deskfox`,本仓改动不涉及
- `pack-installer.sh` 不重写(已存在且 rename 逻辑正确)
- 老 Gitee 仓 archive — Gitee 后台动作,user 自管

## 关联

- 起源:[macOS] 2026.5.11.1 ship 落地后 user 反馈 .dmg 文件名不符规范 + 顺手 Gitee 改名生效
- Mac ship SOP 补全:`win-ship-local-pack-switch` changelog 已列"Mac 本地打包流程补全 backlog",本笔执行
- 后续 feat:Mac ship 流程实测一次完整 `pack-installer.sh -Env prod`(下次 ship 时验证)
