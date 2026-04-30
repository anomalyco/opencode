# 实施工作流:opencode-for-office-deskfox 使用统计与升级通知

> **状态**:V1.0 — 全部 OQ 已解决,可进入 `/sc:implement`
> **日期**:2026-04-29
> **前置文档**:
> - `requirements-telemetry-and-update.md`(需求)
> - `design-telemetry-and-update.md`(设计)
> **决策**:Phase 1 零证书方案 + 域名 `deskfox.ai` + 新 package `packages/telemetry` + 5+5 个 L4 事件

---

## 0. 总览

### 0.1 工作流分轨

工作流分 **4 条独立轨道**,可大量并行,由统一的滚动发布门控收口:

| 轨道 | 责任域 | 阻塞性 |
|---|---|---|
| **S** Server | Tokyo 服务器:Plausible / Updates / Grafana / nginx | 阻塞 α 发布 |
| **C** Client SDK | 公共 `packages/telemetry` + 桌面集成(2026-04-30 砍掉 CLI/Web 集成) | 阻塞 α 发布 |
| **D** Distribution | 微软商店打包 + Linux/macOS 分发包 | 阻塞 γ 发布 |
| **X** Cross-cutting | 隐私政策 / README / CI/CD | 阻塞 γ 发布 |

**作用域调整(2026-04-30)**:Phase 1 范围聚焦**桌面端**。
- ✅ 保留:`packages/telemetry`(C1)+ Desktop 集成(C3)
- ❌ 砍掉:CLI 集成(C2)+ Web 集成(C4)
- 影响:Plausible 后台的 `opencode.cli` / `opencode.web` 站点暂时不会有事件流入(已建好但闲置),不删,留作未来可能恢复

### 0.2 估时合计

| 轨道 | 工作量 | 等待时间 |
|---|---|---|
| S Server | ~5h | DNS 传播 0.5–24h |
| C Client SDK | ~3 工作日 | — |
| D Distribution | ~3 工作日 | 微软商店审核 1–7 天 |
| X Cross-cutting | ~1 工作日 | 法务审核(若有)1–3 天 |
| α 观察 | — | ≥3 天 |
| β 观察 | — | ≥3 天 |

**关键路径(critical path)**:S1 → S2 → C1 → C2 → α → β → D2(商店审核)→ γ
**不在关键路径**:S3 (Grafana)、S4 (Updates)、X1 (Privacy 文档)、C4 (Web 集成)— 都可并行

### 0.3 决策回顾

| 项 | 值 |
|---|---|
| 域名 | `deskfox.ai` 泛解析,3 子域:`telemetry` / `updates` / `grafana` |
| 服务器 | AWS Lightsail Tokyo `52.197.46.120`,2C4G + 2GB swap(已加) |
| 遥测平台 | Plausible self-host(ClickHouse 限内存 1.2G) |
| 看板 | Plausible 主看板 + Grafana 二次看板 |
| 客户端 SDK | 新 workspace package `packages/telemetry` |
| Win 分发 | 微软商店 `DeskFoxAI`(商店自动签 + 自动更新) |
| macOS 分发 | 官网 `.dmg` 无签 + 启动检测新版手动下载提示 |
| Linux 分发 | AppImage / `.deb` + electron-updater |
| L4 事件 | CLI 5 个 + Desktop 5 个(详见设计 §5.1 / §5.2) |
| 隐私 | 默认开 + 三入口关闭(env / flag / config) |

---

## 1. 已完成

| ID | 任务 | 状态 |
|---|---|---|
| **P0.1** | 加 2GB swap + swappiness=10 | ✅ 2026-04-29 |
| **P0.2** | journald 限制 500M + drop-in 配置 | ✅ 2026-04-29 |
| **P0.3** | `.gitignore` 加固 `*.pem` `*.key` | ✅ 2026-04-29 |
| **P0.4** | 需求文档 + 设计文档落地 | ✅ 2026-04-29 |

---

## 2. 轨道 S — 服务器

### S1. DNS + TLS

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **S1.1** 在 deskfox.ai DNS 商加 3 条 A 记录(`telemetry`/`updates`/`grafana`)指向 `52.197.46.120` | 10m | — | `dig +short telemetry.deskfox.ai` 返回 `52.197.46.120` |
| **S1.2** SSH 到东京,用 certbot 申请 3 个证书 | 30m | S1.1(等 DNS 传播) | `sudo certbot certificates` 列出 3 个新证书 |

**命令模板**:
```bash
sudo certbot --nginx -d telemetry.deskfox.ai -d updates.deskfox.ai -d grafana.deskfox.ai
```

> ⚠️ DNS 传播延迟可能从 5 分钟到 24 小时,准备一次失败重试

---

### S2. Plausible 部署

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **S2.1** 在 `/opt/plausible/` 准备 docker-compose.yml(基于官方 self-host 模板) | 30m | S1.2 | 文件就位 |
| **S2.2** 写 ClickHouse 内存补丁 `clickhouse-config.xml`(限 1.2G) | 15m | — | 配置文件就位 |
| **S2.3** 生成 `SECRET_KEY_BASE`,写 `plausible-conf.env` | 10m | — | env 文件就位 |
| **S2.4** `docker compose up -d` 启动栈 | 20m | S2.1–S2.3 | `curl localhost:8000` 返回 200 |
| **S2.5** 创建管理员账号 + 站点 `opencode.cli`、`opencode.desktop`、`opencode.web` | 15m | S2.4 | 后台能登录,3 站点已建 |
| **S2.6** 加 nginx vhost `telemetry.deskfox.ai`,带 rate limit | 20m | S2.5, S1.2 | `curl https://telemetry.deskfox.ai/api/event` 返回非 5xx |
| **S2.7** 配 nginx basic auth 保护管理 UI(`.htpasswd-plausible`) | 10m | S2.6 | 访问 `/` 弹 401,`/api/event` 通行 |
| **S2.8** 烟测:本地手 `curl` 推一条 pageview 事件 | 10m | S2.7 | 后台 Realtime 看到 |

**S2 总估时:~2h10m**

---

### S3. Grafana(可与 S2 后并行)

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **S3.1** 在 `/opt/grafana/` 加 docker-compose service | 15m | S2.4 | 容器起来,3001 端口监听 |
| **S3.2** 在 Plausible PG 上创建只读 user `grafana_ro` | 10m | S2.4 | psql 验证只读权限 |
| **S3.3** Grafana 加数据源(PostgreSQL + ClickHouse) | 15m | S3.2 | 数据源 Test 通过 |
| **S3.4** nginx vhost `grafana.deskfox.ai` + basic auth | 15m | S1.2 | 公网可达 + 401 保护 |
| **S3.5** 创建初始看板:DAU 趋势 / 版本分布 / 国家分布 / L4 事件计数 | 1h | S3.3 | 看板内有 ≥4 个 panel |

**S3 总估时:~2h**(可放到 α 之后做,不阻塞 α)

---

### S4. Update endpoint

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **S4.1** `sudo mkdir -p /var/www/updates/{cli,desktop}` 并设权限 | 5m | — | 目录存在 |
| **S4.2** 放置初始 `cli/latest.json`(指向 v0.0.0,占位) | 5m | S4.1 | curl 返回 JSON |
| **S4.3** 加 nginx vhost `updates.deskfox.ai`(静态 + rate limit) | 15m | S1.2, S4.1 | curl 公网可达 |
| **S4.4** 写一个 release 用的 SCP 脚本骨架 `scripts/push-update-manifest.sh` | 15m | — | 脚本可空跑(--dry-run) |

**S4 总估时:~40m**

---

## 3. 轨道 C — 客户端 SDK

### C1. `packages/telemetry` 公共包

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **C1.1** 新建 workspace package `packages/telemetry`,加 `package.json`/`tsconfig.json` | 30m | — | `bun install` 成功 |
| **C1.2** 实现 `install_id.ts` — 读/写 `~/.config/opencode/install_id`,首次生成 UUIDv4,文件权限 600 | 1h | C1.1 | 单测覆盖:首次生成 / 二次读取 / 损坏重建 |
| **C1.3** 实现 `config.ts` — 解析 env / config / flag,输出布尔决策 | 45m | C1.1 | 单测覆盖三优先级 |
| **C1.4** 实现 `transport.ts` — fetch + 5min/20 条缓冲 + 指数退避(最多 3 次) | 1.5h | C1.1 | 单测:网络失败不抛、缓冲冲洗 |
| **C1.5** 实现 `update_check.ts` — `GET /v1/latest/<client>` + `~/.cache/opencode/update_check.json` 24h 缓存 | 1h | C1.1 | 单测:缓存命中跳过网络 |
| **C1.6** 实现 `index.ts` — 公共 API: `track(event)` / `heartbeat()` / `checkUpdate()` / `firstRunNoticeIfNeeded()` | 1h | C1.2–C1.5 | 单测:opt-out 短路所有 fetch |
| **C1.7** 写 README + JSDoc 描述 SDK 用法 | 30m | C1.6 | README 有完整示例 |

**C1 总估时:~6h15m**

> 🔑 **门控**:C1 全绿才可开始 C2/C3/C4

---

### ~~C2. CLI 集成~~ — **已在 2026-04-30 review 时砍掉,不做**

> 决策:Phase 1 范围聚焦桌面端,CLI 不再做遥测/升级集成。本节保留作历史记录;若未来需要再恢复,可参考此处规格。

### ~~C2. CLI 集成(`packages/opencode`)~~

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **C2.1** 加 `@opencode/telemetry` 为 dep | 5m | C1 | 导入不报错 |
| **C2.2** 在 `src/index.ts` 启动钩子:`firstRunNoticeIfNeeded()` + `heartbeat()`(后台 fire-and-forget) | 30m | C2.1 | 启动后不阻塞主流程,本地能看到 install_id 文件被创建 |
| **C2.3** 加 5 个事件埋点:`session_start` / `tool_run` / `error` / `command_completed` / `upgrade_seen` | 1.5h | C2.1 | 各埋点位置正确,事件名一致 |
| **C2.4** 加 `--no-telemetry` flag(全局 flag) | 30m | C2.1 | 用 flag 启动后无遥测请求 |
| **C2.5** 进程退出钩子:`flush()` 缓冲 | 20m | C2.1 | 短命令也能上报事件 |
| **C2.6** CLI 升级提示:`checkUpdate()` + `detectInstallMethod()`(npm/bun/brew/curl 检测) | 1.5h | C2.1 | 各安装方式给出对应升级命令 |
| **C2.7** 集成测试:启动 CLI,验证 Plausible 后台 realtime 看到事件 | 30m | S2 + C2.2–C2.5 | 后台看见 install / launch 事件 |

**C2 总估时:~4h45m**

---

### C3. Desktop Electron 集成(`packages/desktop-electron`)

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **C3.1** 加 `@opencode/telemetry` 为 dep | 5m | C1 | 导入不报错 |
| **C3.2** 主进程 `app.whenReady()` 钩子:`firstRunNoticeIfNeeded()`(模态对话框)+ `heartbeat()` | 1h | C3.1 | 首启出现卡片,二启不再 |
| **C3.3** 加 5 个事件埋点:`app_open` / `project_open` / `ai_request` / `update_downloaded` / `update_applied` | 1.5h | C3.1 | 埋点位置正确 |
| **C3.4** 设置项 UI:加"使用统计"开关(默认开) | 1h | C3.1 | UI 切换后 fetch 行为改变 |
| **C3.5** **Linux 分支**:`autoUpdater.setFeedURL({ provider: "generic", url: "https://updates.deskfox.ai/desktop" })` + `checkForUpdatesAndNotify()` | 1h | C3.1, S4 | 在 Linux AppImage 上模拟新版,触发下载流程 |
| **C3.6** **macOS / Windows-外站分支**:`manualUpdateCheck()` — 弹原生对话框,点击 `shell.openExternal()` 打开下载页 | 1h | C3.1, S4 | macOS 上模拟新版,弹窗 + 跳转浏览器正确 |
| **C3.7** Windows 商店分支:`process.windowsStore` 检测,跳过 update check(商店接管) | 30m | C3.1 | 商店包内不会触发自定义检查 |
| **C3.8** 三平台烟测(macOS / Windows / Linux 至少一台真机或 VM) | 2h | C3.2–C3.7 | 三平台首启告知 + 心跳 + 升级路径都正确 |

**C3 总估时:~8h**(含三平台烟测,是 C 轨最重)

---

### ~~C4. Web 集成~~ — **已在 2026-04-30 review 时砍掉,不做**

> 决策:Phase 1 范围聚焦桌面端,Web 不再做遥测集成。本节保留作历史记录。

### ~~C4. Web 集成(`packages/app`)~~

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **C4.1** HTML head 加 Plausible script(指向 `telemetry.deskfox.ai`) | 10m | S2 | 页面访问后 Plausible realtime 看到 |
| **C4.2** 加 cookie banner(可选,GDPR 合规)+ 关闭按钮 | 1.5h | C4.1 | 初次访问出现,关后不再 |
| **C4.3** 封装 `track(event)` helper,触发 5 个 web 事件(待 OQ-C-web 敲定,先按设计 §5.3 占位) | 30m | C4.1 | 自定义事件后台可见 |

**C4 总估时:~2h10m**

> ⚠️ **OQ-C web 子项遗漏**:设计文档 §5.3 没有给 web 端 5 个事件清单。建议在实施前用 30 分钟敲定(例如 `web.signin` / `web.project_create` 等)。**这是当前唯一漏掉的 OQ**。

---

## 4. 轨道 D — 分发

### D1. Linux + macOS 自建分发

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **D1.1** electron-builder 配 macOS `.dmg` + Linux AppImage + `.deb` 三产物 | 2h | C3 | `bun run build` 三产物出齐 |
| **D1.2** 测 macOS Gatekeeper 警告流程,写绕过指引到 README | 30m | D1.1 | README 中英双语段落 |
| **D1.3** 测 Linux AppImage 自更新 end-to-end | 1h | D1.1, S4 | 旧版启动 → 检测到新版 → 下载 → 重启已升级 |
| **D1.4** 加签名占位:electron-builder 配置预留 `mac.identity` 和 `win.certificateFile`(Phase 2 启用) | 15m | D1.1 | 配置存在但 commented out |

**D1 总估时:~4h**

---

### D2. Windows 微软商店

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **D2.1** electron-builder 配 MSIX 输出(`win.target: "appx"` 或 `"msix"`) | 1.5h | C3 | `bun run build:win` 产 .msix 文件 |
| **D2.2** Microsoft Partner Center 创建应用 `DeskFoxAI` 提交资料(图标、截图、隐私政策链接、年龄分级) | 2h | D2.1, X1 | Partner Center 显示"准备提交" |
| **D2.3** 上传 .msix 包并提交审核 | 30m | D2.1, D2.2 | 状态从"准备"→"审核中" |
| **D2.4** ⏳ **等待微软审核**(通常 1–7 天) | — | D2.3 | 状态变为"已发布" |
| **D2.5** 公开商店链接,把 README "Windows 安装"段指向商店 | 30m | D2.4 | 链接可访问 |

**D2 总估时:~4.5h 工作 + 1–7 天等待**

> ⚠️ D2.4 是 γ 发布的最大不确定性源 — 必须在 β 期就提交,以免阻塞 γ

---

## 5. 轨道 X — 横向工作

### X1. 隐私政策与 README

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **X1.1** 写中英双语隐私政策草稿(列字段、保留期、关闭方式) | 2h | — | 草稿 PR |
| **X1.2** 法务/维护者审阅 + 定稿 | — | X1.1 | 合并 |
| **X1.3** 部署到 `https://deskfox.ai/privacy`(静态站) | 30m | X1.2 | 公网可访问 |
| **X1.4** README 加段落:Telemetry 说明 + 关闭方式 + macOS Gatekeeper 绕过 | 1h | X1.2 | README 中英版同步更新 |
| **X1.5** 设计 doc / requirements doc / workflow doc 中所有 `<隐私政策链接>` 占位替换 | 15m | X1.3 | grep 无残留占位 |

**X1 总估时:~3h45m + 法务等待**

---

### X2. CI/CD

| 任务 | 估时 | 前置 | 验收 |
|---|---|---|---|
| **X2.1** GitHub Secrets 加 `TOKYO_SSH_KEY`(.pem 内容)和 `TOKYO_HOST` | 10m | — | secrets 列表可见 |
| **X2.2** 写 `.github/workflows/release.yml` 步骤:构建后 SCP `latest*.yml` + `latest.json` 到 Tokyo | 1h | S4, D1, D2 | 测试 release 走完整链路 |
| **X2.3** 写 OSS 上传步骤(若不复用现有):上传 `.dmg` / `.AppImage` 到阿里云 OSS,把 URL 写回 `latest.json` | 1h | — | 测试上传成功 |
| **X2.4** 验证一次完整 dry-run release(打 tag → 走 pipeline → manifest 已上传 → 客户端能升级) | 1.5h | X2.1–X2.3 | end-to-end 验证 |

**X2 总估时:~3h40m**

---

## 6. 滚动发布门控

### α — 内部 2 人

**入口条件**:
- ✅ S1, S2, S4 完成
- ✅ C1, C2, C3 完成(C4 可不阻塞)
- ✅ X2 完成
- ✅ X1.4 完成(README 已说明 telemetry)

**操作**:
1. 维护者 2 人各打一版 dev build,本地装上
2. 启动应用,确认告知卡片出现
3. 关闭卡片,继续使用 30 分钟
4. 检查 Plausible realtime 看到 2 个 install_id

**通过标准**:Plausible 后台显示 ≥2 active installs,L4 事件计数正常

**观察期**:**≥3 天**,期间不可有任何遥测引发的客户端崩溃

---

### β — 内部 5 人

**入口条件**:α 通过 + 3 天无 issue + S3(Grafana)完成

**操作**:
1. 找 5 名内部用户(开发同事或友好测试者),分发 dev build
2. 让他们正常使用 ≥3 天

**通过标准**:
- DAU 看板稳定显示 5
- 各客户端类型(CLI / Desktop)能区分
- 无 OOM、无 nginx 5xx 飙升

**观察期**:**≥3 天**

---

### γ — 公开发布

**入口条件**:
- ✅ β 通过
- ✅ D1 完成(macOS / Linux 包就绪)
- ✅ D2.4 完成(微软商店审核通过)
- ✅ X1 完成(隐私政策上线)

**操作**:
1. 打公开 release tag
2. CI/CD 推送 manifests
3. README / 官网 / 商店链接同步更新
4. 在 deskfox.ai 主页 / 公众号 / GitHub 公告

**通过标准**(发布后第一周):
- Country 分布合理(不只中国)
- 版本分布看到 ≥80% 在最新或上一版
- 无被社区用户控诉"未告知遥测"
- 服务器内存使用稳定 < 3.5GB,无 OOM

---

## 7. 依赖图

```
P0 (DONE)
   │
   ├─→ X1.1 ──→ X1.2 ──→ X1.3 ─┐
   │              └──→ X1.4 ───┤
   │                            │
   └─→ S1.1 ─→ S1.2 ─┬─→ S2 ──→ S3   │
                      │                 │
                      └─→ S4 ───────────┤
                                        │
   C1 (parallel from start) ───────────┤
                                        │
   C1 ──→ C2 ──→ C2.7 (smoke S2)       │
   C1 ──→ C3 ─┬─→ D1 ─────────────┐    │
              └─→ C3.7 (store)     │    │
                                   ├───►α (≥3d)──►β (≥3d)──►γ
   C1 ──→ C4 ─────────────────────┤
                                   │
   X2.1, X2.2 ──→ X2.4 ───────────┤
                                   │
   D2.1 ──→ D2.2 ──→ D2.3 ──→ D2.4 (1-7d)──→ D2.5
                                                  │
                                                  └► γ
```

**关键路径(假设无外部等待)**:`P0 → S1 → S2 → C1 → C3 → D1 → α → β → γ`,约 **10 个工作日**
**实际关键路径(含微软商店)**:加上 D2.4 的 1–7 天,**总约 2–3 周**

---

## 8. 风险登记

| ID | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R-1 | 微软商店审核被拒 | 中 | 高(γ 阻塞) | 提前在 β 阶段就提交;留 fallback "官网下载" |
| R-2 | Plausible 启动 OOM | 低 | 高(S2 阻塞) | swap 已加;ClickHouse 内存已限;先 stop 其他容器再起 |
| R-3 | DNS 传播超 24h | 低 | 中(S1 阻塞) | 同时配 deskfox.ai 主 NS,确认 TTL 较短 |
| R-4 | macOS Gatekeeper "App is damaged" 误杀 | 高 | 中(用户首启失败) | README 中英文 + 视频指引 |
| R-5 | install_id 文件被云端同步(Dropbox / OneDrive)同 ID 跨机器 | 低 | 低(数据轻微失真) | 文件位置选 `~/.cache/`(不被同步)而非 `~/.config/`;注释说明 |
| R-6 | 用户 IP 被 Plausible 写入,违反隐私承诺 | 中 | 高(社区舆情) | nginx 在 proxy 前剔除 IP / Plausible 配置 `IP_GEOLOCATION_DB` 后立即 hash |
| R-7 | 客户端 fetch 阻塞主流程导致启动慢 | 中 | 中 | 所有 fetch fire-and-forget,加 5s 超时 |
| R-8 | Plausible 后端被攻击(DDoS / 刷量) | 低 | 中 | nginx rate limit(已设计);Cloudflare 前置(可选 Phase 2) |

---

## 9. 测试矩阵

| 测试 | C1 | C2 | C3 | 覆盖项 |
|---|---|---|---|---|
| **单测** | install_id / config / transport / update_check | 安装方式探测 / 升级提示文案 | 平台分支 / 设置切换 | C1.* / C2.6 / C3.* |
| **集成测** | — | CLI 启动→Plausible realtime 见事件 | Electron 启动→事件 + 升级流程 | C2.7 / C3.8 |
| **opt-out 验证** | — | env / flag / config 三入口各跑一遍 | UI 开关 + env 各跑一遍 | FR-7 |
| **网络断开** | transport 重试不崩 | CLI 在飞行模式启动正常 | Electron 在飞行模式启动正常 | NFR-2.4 |
| **跨平台烟测** | — | Linux / macOS / Win | Linux / macOS / Win | C3.8 |

---

## 10. 进入 `/sc:implement` 前的最后清单

- [ ] **OQ-C-web** 敲定 5 个 web 事件清单(30 分钟)
- [ ] 维护者拿到东京服务器 SSH 密钥的 GitHub Secrets 写入权限
- [ ] 维护者 Microsoft Partner Center 账号能上传应用(确认 DeskFoxAI 状态)
- [ ] DNS 商账号准备好(谁有 deskfox.ai 的 DNS 修改权限)

满足后,执行:

```
/sc:implement docs/workflow-telemetry-and-update.md
```

或者按需选 phase 实施:

```
/sc:implement docs/workflow-telemetry-and-update.md --phase S1,S2
/sc:implement docs/workflow-telemetry-and-update.md --phase C1
```

---

## 11. 文档树

```
docs/
├── requirements-telemetry-and-update.md    # 需求规格(V1.0)
├── design-telemetry-and-update.md          # 架构设计(V1.0)
└── workflow-telemetry-and-update.md        # 实施工作流(V1.0,本文件)
```

三份文档构成完整的从需求 → 设计 → 实施的链路。任何后续修改请保持三者一致(如改了字段需求 → 同步设计的事件 schema → 更新工作流的埋点任务)。
