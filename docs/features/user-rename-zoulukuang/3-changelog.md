---
feat-id: user-rename-zoulukuang
status: done
related: ./3-changelog.md
---

# user-rename-zoulukuang — changelog

## 触发

`repo-migration-deskfox` 收尾后,user 把 GitHub 用户名 `yuesoue` 改成 `zoulukuang`,对齐 Gitee 用户名(Gitee 端一直叫 `zoulukuang`)。

收益:
- 跨平台 identity 统一(GitHub / Gitee 都是 `zoulukuang`)
- 后续 Gitee 镜像迁(backlog F2)落地后,两端 owner / repo 名都对齐:`{github,gitee}.com/zoulukuang/deskfox`
- repo URL 的"现状名"在所有引用里收敛一致

## 改名前后状态

| 项 | 改名前 | 改名后 |
|---|---|---|
| GitHub 用户名 | `yuesoue` | `zoulukuang` |
| GitHub user id | `135399711` | `135399711`(同账号,只换 login)|
| GitHub user URL | `github.com/yuesoue` | `github.com/zoulukuang`(老 URL GitHub 一段时间内 redirect)|
| 主仓 URL | `github.com/yuesoue/deskfox` | `github.com/zoulukuang/deskfox` |
| 老仓 URL | `github.com/yuesoue/opencode-for-office-deskfox` | `github.com/zoulukuang/opencode-for-office-deskfox` |
| Gitee 用户名 | `zoulukuang`(不变) | `zoulukuang`(不变) |

## 操作执行

### Phase 1 — GitHub web 改名(user 操作)

1. user 自己 web Settings → Account → Change username `yuesoue` → `zoulukuang`
2. ~~(建议但 user 决策)立即注册 `yuesoue` 空号占位防 squat~~ —— **2026-05-04 user 决定弃做**:项目当前阶段小(老仓 0 stars / 0 forks / 0 watchers),squat 后实际能"接管"的流量微不足道,运维一个空号比承担风险更不划算。接受 redirect 在他人注册老名后失效的风险

### Phase 2 — 验证改名生效

```powershell
# 新名活
GET https://api.github.com/users/zoulukuang
  → 200, login=zoulukuang, id=135399711, created_at=2023-06-03T02:21:54Z

# 新仓在(fork 关系保留)
GET https://api.github.com/repos/zoulukuang/deskfox
  → 200, fork=true, parent=anomalyco/opencode

# 老 URL git 协议 redirect 工作
git ls-remote https://github.com/yuesoue/deskfox.git HEAD
  → 返 HEAD SHA 正常(redirect 透明)
```

### Phase 3 — 切本地 git remote URL

```bash
git remote set-url origin https://github.com/zoulukuang/deskfox.git
git remote set-url origin-legacy https://github.com/zoulukuang/opencode-for-office-deskfox.git
```

`gitee` 和 `upstream` 不动(本来就不依赖 yuesoue)。

### Phase 4 — 改活跃 docs URL(5 处)

| 文件 | 行 | 改动 |
|---|---|---|
| `docs/installer-versions.md` | 28 | 当前 release 链接 `yuesoue/deskfox` → `zoulukuang/deskfox` |
| `docs/legal/PRIVACY.md` | 20 / 279 / 469 / 472 | 4 处英文版 GitHub URL |
| `docs/legal/隐私协议.md` | 20 / 279 / 469 / 472 | 4 处中文版 GitHub URL |
| `改动日志.md` | 58 / 59 / 60 | origin / origin-legacy / gitee 三行基线信息 + 加 user 改名背景注 |
| `改动日志.md` | 37 | 历史 release 链接 `yuesoue/opencode-for-office-deskfox` → `zoulukuang/opencode-for-office-deskfox`(GitHub redirect 兜着,但显式更干净)|
| `改动日志.md` | 48 | repo-migration 行 backlog 段把"user 改名 暂缓"删,改"已落地" |
| `docs/features/INDEX.md` | 42 | repo-migration 行末部分名字更新 + 加本笔行 |
| `docs/features/release-自动化/3-changelog.md` | 23 | 历史 release 链接同步改 |

### Phase 5 — 历史档案不改(策略)

下列文件**含 `yuesoue` 字面但属历史叙述/已冻结**,不动:

- `docs/features/repo-migration-deskfox/3-changelog.md` —— 迁移当时的叙述(target 写 `yuesoue/deskfox` 是当时事实),只在顶部加一行 rename 增补 note
- `docs/history/沟通记录.md` —— 早期沟通记录,frozen
- `docs/history/changelog-pre-v2.md` —— pre-v2 archive,frozen
- `docs/STATUS.md` / `docs/PLANNING-OVERVIEW.md` / `docs/governance/跨平台协作.md` —— 含 `yuesoue/opencode-for-office`(更早的旧仓名),已是 stale 历史内容,不在本笔 scope

### Phase 6 — 老仓 deprecation banner URL 改名

老仓 README banner 在 `chore/deprecate-old-repo-readme` 临时分支(已删本地)推到 `origin-legacy:dev`,banner 里的"前往新仓"URL 还指 `yuesoue/deskfox`,本笔顺手改成 `zoulukuang/deskfox`。

## 验证

| 项 | 状态 |
|---|---|
| `zoulukuang` 在 GitHub 活 | ✅(API 200,id 同) |
| `zoulukuang/deskfox` fork 关系保留 | ✅(`fork=true, parent=anomalyco/opencode`) |
| 老 git URL 仍 redirect 工作 | ✅(`git ls-remote yuesoue/deskfox.git` 返 HEAD) |
| 本地 origin / origin-legacy URL 切到新名 | ✅ |
| 5 个活跃 docs 文件 8 处 URL 更新 | ✅ |
| 老仓 deprecation banner URL 改名 + push | (本笔执行)|
| commit + push 到 zoulukuang/deskfox 通 | (本笔执行)|

## 影响范围

### 直接收益
- 跨平台 identity 统一,Gitee / GitHub owner 名一致
- 所有"现状名"引用收敛到 `zoulukuang`,文档语义一致

### 风险 / 已缓解
- **redirect 不是永久绝对安全**:GitHub 老 URL redirect 在,但任何人后续注册 `yuesoue` 后 redirect 会失效 —— ~~缓解:user 改完后立即注册 `yuesoue` 空号占住(防 squat)~~ **2026-05-04 决定弃**:项目小,squat 风险低,接受不防
- **协作端**:Mac 协作端的 `git remote -v` 还是老 URL,redirect 兜底能用,但建议下次协调时统一 `git remote set-url origin https://github.com/zoulukuang/deskfox.git`(此项归并到 `repo-migration-deskfox` backlog 的 "Mac 端 origin 切换")

## R4 override

无(全在 fork 治理白名单 + docs 内,0 代码改)。

## 关联

- 前置:`repo-migration-deskfox`(主仓迁完为本笔铺好真正可命名的 repo)
- 同步 backlog:Gitee 镜像迁(`gitee.com/zoulukuang/deskfox` 待手动新建 + auto-sync from `github.com/zoulukuang/deskfox`)
