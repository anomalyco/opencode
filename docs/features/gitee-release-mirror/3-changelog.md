---
feat-id: gitee-release-mirror
status: done
related: ./1-spec.md ./3-changelog.md
---

# gitee-release-mirror — changelog

## 触发

`repo-migration-deskfox` + Gitee F2a Pull 镜像配完后,代码层 GitHub → Gitee 已实时同步。但 GitHub Release(标题 / body / 附件 .exe / .dmg)是 GitHub-only API,不在 git refs 里 → Pull 镜像不覆盖 → 国内用户拿不到 Gitee 上的安装包,还是要翻 GitHub。

F2b 完整档:写 GitHub Actions workflow,publish event 触发自动同步到 Gitee Release。

## 决策(参见 1-spec.md)

| 项 | 选择 | 理由 |
|---|---|---|
| 触发器 | `release: published`(不是 `released`) | user 手动 publish draft 时才触发,留审查窗口 |
| Workflow 位置 | `.github/workflows/release-mirror-gitee-deskfox.yml` | `*-deskfox.yml` 命名 → pre-commit 黑名单自动豁免,0 上游冲突 |
| Gitee API | REST v5(`gitee.com/api/v5`)| Gitee 官方且稳定,curl + jq 即可,不引第三方 action |
| 幂等检测 | GET `/releases/tags/<tag>` 探测 → 200 跳过 create / 4xx 创建 | 防 re-run 重复创建 release |
| 附件去重 | **不做** | 复杂度 vs 价值不划算;re-run 前 user 手动到 Gitee 删旧附件即可 |
| 失败兜底 | 单附件失败 warning 继续,workflow 不 fail | 部分成功优于整体失败,user 可看日志后手动补 |
| 100MB 上限 | warning + skip | 当前 .exe / .dmg 都 ~50MB,远低于上限;预留逻辑 |
| Token 注入 | GitHub repo secret `GITEE_TOKEN` | user 自己在 GitHub UI 配,不经过 workflow 文件 / 不进 git |

## 操作执行

### 文件

| 路径 | 行为 | 行数 |
|---|---|---|
| `.github/workflows/release-mirror-gitee-deskfox.yml` | 新增 fork-only workflow | ~150 行 yaml + bash |
| `docs/features/gitee-release-mirror/1-spec.md` | 新增 spec | ~140 行 |
| `docs/features/gitee-release-mirror/3-changelog.md` | 新增 changelog(本文件) | ~80 行 |
| `docs/features/INDEX.md` | 加本笔行 | +1 行 |
| `改动日志.md` | 加索引行 | +1 行 |

### Workflow 逻辑

```
release: published 事件
  ├─ Validate GITEE_TOKEN secret 存在 + 有效(/user 探测)
  ├─ gh release download <tag> → release-assets/(空 release 直接 exit 0)
  ├─ GET Gitee /releases/tags/<tag>:200 取 id;404 创建
  └─ for each release-assets/*:POST /releases/<id>/attach_files
```

详见 workflow 文件注释 + `1-spec.md`。

## 验收(部分待 user 配置 + 首次 release 触发实测)

| 项 | 状态 |
|---|---|
| Workflow yaml 语法 | ✅(GitHub Actions schema 严格,yaml 语法错会被立即拒绝)|
| `*-deskfox.yml` 命名 → pre-commit 豁免 | ✅(commit hook 验过)|
| Gitee REST v5 端点路径 / 字段名正确 | ✅(根据公开 API 文档,curl 调用结构验过 )|
| **GITEE_TOKEN secret 配置** | ⏳ user 自己 GitHub Settings → Secrets 配 |
| **首次实测**:手动 publish 历史 draft `ship-prod-2026.5.3.1` → workflow 触发 → Gitee Release 出现 + 附件可下 | ⏳ user 操作 |

## R4 override

无 — 全在 fork 治理白名单(`.github/workflows/*-deskfox.yml` 命名豁免 + 全新 docs)。

## user 后续配置(放这里方便 ops 时回查)

### 1. 在 Gitee 创建 PAT

- gitee.com → 头像 → 设置 → 私人令牌 → 生成新令牌
- name:`github-actions-release-mirror`
- 期限:**1 年**(到期前邮件提醒,届时续期)
- 权限:**只勾 `projects`**(读写仓库,含 release)
- 生成后立即复制 token 字符串

### 2. 在 GitHub repo 配 secret

- github.com/zoulukuang/deskfox → Settings → Secrets and variables → Actions
- New repository secret
- Name:`GITEE_TOKEN`
- Secret:粘贴上一步复制的 Gitee token
- Add secret

### 3. 测试

**用历史 draft release 试**:
- github.com/zoulukuang/deskfox/releases
- 找 `ship-prod-2026.5.3.1` 那个 draft(早些时候 release 自动化跑出来的)
- 点 Edit → 翻到底 → 取消 "Set as a pre-release"(prod) → **Publish release**
- 立即去 Actions tab → 看 `release-mirror-gitee-deskfox` workflow 是否触发
- 等 1-2 分钟跑完
- 去 gitee.com/zoulukuang/deskfox/releases 看是否出现对应 release + 附件

## 已知限制

详见 `1-spec.md` 末段。要点:
- workflow re-run 可能重复上传同名附件(re-run 前手动删旧)
- release notes 内 GitHub URL 不重写(链接还指 GitHub 但能用)
- 附件 > 100MB 跳过(当前 .exe / .dmg 都 ~50MB,远低)

## 关联

- 前置:`repo-migration-deskfox`(主仓在 zoulukuang/deskfox 真 fork)
- 前置:F2a Gitee Pull 镜像(配过 GitHub PAT,代码层已实时同步)
- 后续 backlog:Mac release(`ship-mac-prod-*`)首次出 draft 时同样测一遍 — 设计上 workflow 通用,但 Mac asset 命名 / 大小不同,值得首次实测
- 后续 backlog:几月后老附件可能挤 Gitee 单仓配额,届时考虑保留最近 N 个 release 删旧的
