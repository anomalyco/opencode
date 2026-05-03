---
feat-id: gitee-release-mirror
status: done
related: ./1-spec.md ./3-changelog.md
---

# gitee-release-mirror — spec

## 目标

GitHub Release 发布后,自动同步到 Gitee Release(标题 / body / 附件 .exe / .dmg)。让国内用户从 Gitee 直接拿到安装包,不用翻去 GitHub 的 Release 页。

## 现状(F2a 已落地的部分)

| 项 | 状态 |
|---|---|
| Gitee 仓 `zoulukuang/deskfox` 镜像 GitHub 源码 | ✅(F2a Pull 镜像 + admin:repo_hook PAT,实时同步)|
| branches / tags / commits 同步 | ✅(自动)|
| **GitHub Release 同步**(标题 / body / 附件) | ❌ Pull 镜像不覆盖 — Release 是 GitHub-only API/DB,git refs 之外 |

## 需求

### 必须满足

1. **触发**:GitHub Release 从 draft 转 publish 时自动跑(用户审完 draft 才同步,避免 draft 期问题被同步出去)
2. **创建 Gitee Release**:tag / name / body / prerelease 标志一致
3. **上传附件**:`.exe`(Win 49MB) / `.dmg`(Mac 49MB)— 都在 Gitee 100MB 单文件上限内
4. **幂等**:workflow 失败重跑不双倍创建 — 通过查 Gitee Release-by-tag 决定 create/skip
5. **0 上游侵入**:文件名遵守 `*-deskfox.yml`,pre-commit 自动豁免

### 不强制

- 失败重试机制(GitHub Actions 自带 re-run 按钮,user 自己点)
- 删除 Gitee Release(GitHub 那边删了不删 Gitee — 安全侧倾向保留)
- Release notes 内 GitHub URL 改写到 Gitee — body 直接抄,链接还指 GitHub 但能用

## 技术选型

### 触发器

```yaml
on:
  release:
    types: [published]
```

只在 publish 触发,draft / edit / delete 不触发。

### Gitee API 端点(REST v5)

| 用途 | 方法 | 路径 |
|---|---|---|
| 查 release-by-tag(幂等检测)| GET | `/repos/{owner}/{repo}/releases/tags/{tag}` |
| 创建 release | POST | `/repos/{owner}/{repo}/releases` |
| 上传附件 | POST | `/repos/{owner}/{repo}/releases/{id}/attach_files` |

Auth:`access_token=<PAT>` 表单字段 / query 参数。

### 必需字段(POST 创建 release)

| 字段 | 来源 |
|---|---|
| `tag_name` | `${{ github.event.release.tag_name }}` |
| `name` | `${{ github.event.release.name }}` |
| `body` | `${{ github.event.release.body }}` |
| `prerelease` | `${{ github.event.release.prerelease }}` |
| `target_commitish` | 固定 `dev`(release 已有 tag,Gitee 仍要 branch 字段)|
| `access_token` | `${{ secrets.GITEE_TOKEN }}` |

### Gitee PAT scope 要求

最小:`projects`(读写仓库,含 release 资源)。

获取:Gitee → 设置 → 私人令牌 → 生成新令牌(name: `github-actions-release-mirror`,只勾 `projects`)。

### GitHub secret 名

`GITEE_TOKEN` —— 在 GitHub repo Settings → Secrets and variables → Actions → New repository secret 配。

## 流程

```
[GitHub release: published 事件]
       │
       ▼
[Validate GITEE_TOKEN secret 存在]
       │  (没配则 fail,带可读 error)
       ▼
[gh release download <tag> → release-assets/]
       │  (拉 GitHub release 的全部附件到本地)
       ▼
[GET Gitee /releases/tags/<tag>]
       │
       ├─ 已存在 → 取 release_id,跳过 create
       │
       └─ 404 → POST /releases 创建,取 response.id
       │
       ▼
[for each file in release-assets/]
       │
       ├─ size > 100MB → warning + skip
       │
       └─ POST /releases/<id>/attach_files (multipart, file=@<path>)
       │
       ▼
[print Gitee release URL,workflow 完]
```

## 失败兜底

| 失败点 | 行为 |
|---|---|
| GITEE_TOKEN 没配 | 整个 workflow fail with clear error("配 secret on GitHub Settings → ...")|
| Gitee API 5xx | curl `-f` 失败 → workflow fail → user 手动 re-run |
| 单个附件上传失败 | warning 打印继续(其他附件不受影响),user 看日志后手动补 |
| 附件 > 100MB | warning + skip,user 看到提示去 Gitee 手动找渠道 |
| Gitee 已有同 tag release | skip create,继续上传附件(可能产生重名附件,见已知限制)|

## 已知限制

1. **附件去重未做**:workflow re-run 会双倍上传同名文件(Gitee 不去重)。**缓解**:re-run 前 user 手动到 Gitee release 页删旧附件
2. **release notes 内链接不重写**:`compare to previous` 之类链接还指 GitHub;不影响功能
3. **draft → publish 必须 user 手动**:本 workflow 不会把 draft 自动 publish,这是设计(给 user 审查窗口)
4. **Mac + Win 共享触发**:每次 publish 一次,适合"当次 release 只一种产物"的常见场景。如果同 tag 后续追加附件,要 re-run

## 健康指标

| 指标 | 目标 |
|---|---|
| 单次 sync 时长 | < 60 秒(50MB 附件 × 1) |
| 失败率 | < 5%(以季度统计;主要失败源是 Gitee 限速)|

## 验收

- [ ] workflow 文件 commit + push 完
- [ ] user 配 `GITEE_TOKEN` secret
- [ ] 测试方式:GitHub UI re-publish 历史 draft release(`ship-prod-2026.5.3.1`)→ workflow 触发 → Gitee Release 出现含附件
- [ ] Gitee Release 页 URL 可访问 + 附件可下

## R4 override

无(纯 fork-only 新文件 + 走 `*-deskfox.yml` 黑名单豁免)。

## 关联

- 前置:`repo-migration-deskfox`(主仓真 fork 关系建好,GitHub Release 是从这个仓发的)
- 前置:F2a Gitee Pull 镜像(用户已配,代码层 sync 已通)
- 后续 backlog:`xxx-release-archive-cleanup`(几月后老附件可能挤 Gitee 单仓配额,届时考虑保留最近 N 个 release 删旧的)
