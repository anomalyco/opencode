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

## Pivot 决策(2026-05-04)

### 触发

实施过程中,workflow `release-mirror-gitee-deskfox` 三次实测全部失败(同一卡点):

| 试 | timeout 上限 | 结果 |
|---|---|---|
| 1 | curl `--max-time 600s`(10 min)+ job timeout 20 min | 10 分钟 max-time hit,curl exit 28 |
| 2 | 同 #1 | 同 #1 |
| 3 | curl `--max-time 1800s`(30 min)+ job timeout 60 min | 30 分钟 max-time hit,curl exit 28 |

**根因**:GitHub Actions runner(US 段 IP)→ Gitee 国内服务器,**50MB 上行被 GFW 节流到 30 分钟跑不完**。本机(国内 IP)同样 curl 调用走同 endpoint **5.5 秒** / 76 Mbps 完事。

诊断证据:
- 本机 curl `https://gitee.com/api/v5/repos/.../attach_files` (假 token)<30 秒返 401 → API 端点本身可达性正常
- workflow 创 Gitee release(JSON POST 1KB)瞬时返 201 → 控制流量 OK
- workflow 上传 50MB 附件 → 30 min timeout → 数据流量被节流

### 方案对比

| 方案 | 评价 |
|---|---|
| A. 用 self-hosted runner(国内 VM) | 最干净,但 user 没现成基础设施,运维成本高 |
| B. workflow bump timeout 到 60 min | 还是 timeout,bump 没意义 |
| C. 走 CDN / 代理转发上行 | 出 fork 项目 scope |
| D. 用 GitHub Actions 在 docker 里跑国内 IP | 不靠谱,GitHub 不允许任意 outbound 节点 |
| **E. 混合 — workflow 元数据 + 本地脚本附件**(选用) | workflow 30s 元数据,user 本地脚本 5s 附件,两端各干各的 |

### 实施

#### Workflow `release-mirror-gitee-deskfox.yml` 改动

- ❌ 删 "Download GitHub release assets" step
- ❌ 删 "Upload assets to Gitee release" step
- ✏️ "Resolve metadata" step 末尾把 GitHub Release URL 追加到 Gitee body,让 Gitee 用户在附件还没传完时**直接点链接去 GitHub 下载**(GFW 节流是上行,下行 .exe from GitHub 国内能跑,虽然慢)
- ⏱ `timeout-minutes` 60 → 5(纯 API 调用)
- ➕ "Summary" step 提示 user 跑本地脚本

#### 新本地脚本 `packages/branding/scripts/mirror-asset-to-gitee.ps1`

- 输入 `-Tag <ship-prod-X>`
- 自动定位本地 `.exe`(`packages/branding/installer/Output/`)→ 找不到则 `gh release download` 从 GitHub 下到 `D:\tmp\`
- 校验 `GITEE_TOKEN`(env var,持久化建议 User 作用域)
- GET Gitee releases 列表找 `release_id` by tag
- 已有同名附件 → 跳过(去重)
- curl `attach_files` 上传(国内 IP,5-10 秒)

#### 用户使用流程(每次 release)

```
[user 做]
1. pack-installer.ps1 -Env prod    # 本地 build + bump + commit + tag
2. git push origin --tags          # 触发 release-deskfox.yml
3. (等 GitHub Actions build .exe + 创 draft Release,~10 min)
4. 在 GitHub web UI Edit draft → Publish release
5. (release-mirror-gitee-deskfox 触发,~30 秒在 Gitee 创 release 元数据)

[Claude 做(2026-05-04 起 SOP)]
6. user 一句话告知"传 gitee 了 / release 完了 / publish 了 ship-X" 之类
   → Claude 跑:mirror-asset-to-gitee.ps1 -Tag ship-prod-X
   → 5-10 秒 .exe 上传完,贴 Gitee URL 给 user
```

**职责分工设计**:
- workflow / web UI 的步骤(1-5)只能 user 在自己机器上做(本地 build / web 点 publish)
- 第 6 步是结构性需要"国内 IP"的步骤,GitHub Actions 跑不通,只能本机
- 但 user 不想每次手动跑命令 → Claude 接手第 6 步
- Claude 子进程能读 user 设的 User 作用域 env var `GITEE_TOKEN`,token 持久化无须重设

详见两条 memory:
- `feedback_gitee_release_upload_claude_owns.md` — Claude 主动执行规则
- `project_gitee_token_user_env.md` — token 存放位置 / 续期 / 撤销

### 实测结果

| 指标 | 实测 |
|---|---|
| Workflow 元数据镜像 (run #25279723354) | 30 秒 success ✅ |
| Gitee release `id=669251` 元数据 | tag/name/body/prerelease 全 mirror,body 末尾追加 GitHub URL ✅ |
| 本地脚本上传 `DeskFox-2026.5.3.1-setup.exe` (51.92 MB) | 5.5 秒 / 76 Mbps / HTTP 201 ✅ |
| Gitee 端最终下载 URL | https://gitee.com/zoulukuang/deskfox/releases/download/ship-prod-2026.5.3.1/DeskFox-2026.5.3.1-setup.exe ✅ |

### 已知边界(pivot 后)

1. **Mac `.dmg` 自动定位待补**:本地脚本目前只覆盖 Win,Mac 端要 user 用 `-Asset <path>` 手动指定。下笔 follow-up 加 Mac 路径自动推。
2. **不能完全自动化**:user 手动跑一行命令是结构性必需(本地 IP 是关键)。已在 `pack-installer.ps1` 流程文档中加提示。
3. **同步延迟可见**:从 GitHub publish 到 Gitee 有附件,user 操作需要约 1 分钟(workflow 30s + 本地脚本 5s + user 切窗口操作)。如果 user 没及时跑本地脚本,Gitee release 短期只有元数据 + GitHub 链接(不影响,链接一直能用)。

## 验收

| 项 | 状态 |
|---|---|
| Workflow yaml 语法 | ✅(GitHub Actions parser 接受) |
| `*-deskfox.yml` 命名 → pre-commit 豁免 | ✅ |
| Gitee REST v5 endpoints 验证 | ✅(create + list + attach_files 全跑过)|
| GITEE_TOKEN secret 配置 + 在 workflow 中验通 | ✅(2026-05-03 user 配,scope `projects`,1 年期)|
| **首次实测全链路**(GitHub publish → workflow 元数据 → 本地脚本附件 → Gitee 完整 release)| ✅(`ship-prod-2026.5.3.1` 完成)|
| 本地脚本 PS 5.1 编码处理 | ✅(UTF-8 BOM 修过一次,详见 commit hist)|

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
- 后续 backlog:几月后老附件可能挤 Gitee 单仓配额,届时考虑保留最近 N 个 release 删旧的

## 续笔(2026-05-04):Mac sh 版本补全

Mac 端 release(`ship-mac-prod-2026.5.4.1`)发了 GitHub draft 后,Gitee 那边没法上 .dmg 附件 — Win 端有 `mirror-asset-to-gitee.ps1`,Mac 端缺对应 sh。补:

`packages/branding/scripts/mirror-asset-to-gitee.sh`(~230 行 bash,镜像 .ps1 逻辑):
- 位置参数 1 取 tag(例 `ship-mac-prod-2026.5.4.1`)
- 解析 `ship-mac-(prod|beta)-VERSION` → 自动定位 `packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-${VERSION}_aarch64.dmg`
- 找不到 → `gh release download` 从 GitHub 拉到 `/tmp/gitee-mirror-<tag>/`
- 校验 GITEE_TOKEN(env 或 `--gitee-token` 参数,持久化建议 `echo 'export GITEE_TOKEN="..."' >> ~/.zshrc`)
- GET Gitee releases 列表找 `release_id` by tag
- 已有同名附件 → skip(去重)
- curl `attach_files` 上传(`--connect-timeout 30 --max-time 600`)
- 报告:elapsed + Mbps + Gitee URL

跨平台兼容:
- file size:`stat -f%z`(BSD/macOS)优先,fallback `stat -c%s`(GNU/Linux)+ `wc -c` 兜底
- bash 版本要求 `[[ ... =~ ]]` 正则(bash 3.2+,macOS 自带 3.2 OK)
- 依赖:`curl` + `jq` + `gh`(macOS 可 `brew install jq gh` 一次装)

文件 mode 100755(可执行),user 可直接 `./packages/branding/scripts/mirror-asset-to-gitee.sh ship-mac-prod-X` 或 `bash <path> ship-mac-prod-X` 跑。

Mac 协作者首次实测目标:`ship-mac-prod-2026.5.4.1`(GitHub 上还是 draft,Mac 协作者要先 publish 才能测)。
