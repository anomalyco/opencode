# 架构设计文档:opencode-for-office-deskfox 使用统计与升级通知

> **状态**:V1.0 — 基于已确认需求文档 `requirements-telemetry-and-update.md` 与 Tokyo 服务器实地巡检结果
> **日期**:2026-04-29
> **前置文档**:`requirements-telemetry-and-update.md`(需求规格)
> **后续动作**:确认设计 → 执行 `/sc:workflow` 拆解实施任务

---

## 0. Phase 1 作用域调整(2026-04-30)

review 阶段决定 Phase 1 仅做**桌面端**:

- ✅ **保留**:`packages/telemetry` 公共包 + Desktop Electron 集成
- ❌ **砍掉**:CLI 集成(`packages/opencode`)+ Web 集成(`packages/app`)
- 影响:本文档原有 §5.1 (CLI) 与 §5.3 (Web) 的具体 SDK 接入方式**暂不实施**,但保留作未来恢复参考。Plausible 的 `opencode.cli` / `opencode.web` 站点已建好,闲置不删
- 不变:服务端架构、Plausible 部署、Updates 端点、隐私政策等横向工作均按原计划进行

---

## 1. 设计目标(回顾需求 G1/G2/G3)

| ID | 目标 | 设计映射 |
|---|---|---|
| G1 | 装机量增长可见 | Plausible 看板 |
| G2 | 产品决策(功能使用) | Plausible custom events + Grafana 二次看板 |
| G3 | 用户可达升级 | 桌面 electron-updater + CLI 启动检测 |

---

## 2. 高层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          客户端三态                              │
│  ┌──────────┐  ┌──────────────────┐  ┌────────────────────┐    │
│  │ CLI Bun  │  │ Desktop Electron │  │ Web (SolidStart)   │    │
│  │          │  │ + electron-updr  │  │                    │    │
│  └────┬─────┘  └────┬─────────────┘  └────┬───────────────┘    │
│       │ 心跳/事件   │ 心跳/事件 + 更新检查 │ 心跳/事件         │
└───────┼────────────┼─────────────────────┼─────────────────────┘
        │            │                     │
        │       HTTPS / 443 (公网)         │
        ▼            ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│           Tokyo (52.197.46.120) — 2C 4G + 2G swap              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                       nginx (现有)                        │  │
│  │   telemetry.deskfox.ai:443 ──────► 127.0.0.1:8000 (Plausible)  │  │
│  │   updates.deskfox.ai:443   ──────► /var/www/updates/ (静态)    │  │
│  │   grafana.deskfox.ai:443   ──────► 127.0.0.1:3001 (基础认证)   │  │
│  │   (现有 vhosts: api/ga/getbot/openclaw — 不动)            │  │
│  └──────────┬─────────────────────┬──────────────┬──────────┘  │
│             │                     │              │             │
│  ┌──────────▼──────────┐  ┌──────▼─────┐  ┌─────▼──────────┐   │
│  │   Plausible stack    │  │  Static    │  │   Grafana      │   │
│  │   (docker-compose)   │  │  JSON      │  │   :3001        │   │
│  │   ┌────────────────┐ │  │  files     │  │                │   │
│  │   │ Plausible :8000│ │  │            │  │                │   │
│  │   │ PostgreSQL     │◄┼──┼────────────┼──┤ (read-only)    │   │
│  │   │ ClickHouse     │ │  │            │  │                │   │
│  │   └────────────────┘ │  │            │  │                │   │
│  └──────────────────────┘  └────────────┘  └────────────────┘   │
│                                                                 │
│  (现有共存: docker(new-api:3000), xray:8443, certbot 已配)      │
└─────────────────────────────────────────────────────────────────┘
                       │
                       ▼
       ┌────────────────────────────────┐
       │  CI/CD (GitHub Actions / 本机)  │
       │  发版时:                         │
       │  - 上传 installer 到 OSS         │
       │  - SCP 更新 latest.json 到东京   │
       └────────────────────────────────┘
```

---

## 3. 服务端拓扑(Tokyo)

### 3.1 网络与 vhost 规划

| 子域 | 端口 | 后端 | 用途 | TLS |
|---|---|---|---|---|
| `telemetry.deskfox.ai` | 443 | 127.0.0.1:8000 | Plausible 事件接收 + 看板 | 新发 |
| `updates.deskfox.ai` | 443 | nginx static `/var/www/updates/` | 升级检查(JSON / electron-updater) | 新发 |
| `grafana.deskfox.ai` | 443 | 127.0.0.1:3001 + basic auth | Grafana 二次看板 | 新发 |

> **域名归属未定** → 见 OQ-A;暂以 `deskfox.ai` 占位

### 3.2 进程/容器

| 服务 | 部署方式 | 内存预算 | 端口 |
|---|---|---|---|
| Plausible | docker-compose | 500 MB | 8000(本机) |
| PostgreSQL(Plausible 用) | docker-compose | 400 MB | 5432(本机,docker net) |
| ClickHouse(限内存) | docker-compose,`max_server_memory_usage=1.2G` | 1.2 GB(硬上限) | 8123/9000(本机,docker net) |
| Grafana | docker-compose | 200 MB | 3001(本机) |
| node_exporter(可选) | systemd | 50 MB | 9100(本机) |
| **新增合计** | | **~2.4 GB** | |

加上现有占用(~800 MB)+ 系统(~600 MB) ≈ **3.8 GB** ≈ 全部物理内存。  
**swap 2GB 已加,作为突发缓冲**。

### 3.3 ClickHouse 内存约束(critical)

`docker-compose.yml` 必须给 ClickHouse 加配置:

```yaml
clickhouse:
  ulimits:
    nofile: { soft: 262144, hard: 262144 }
  environment:
    - CLICKHOUSE_DEFAULT_PROFILE=low_memory
  volumes:
    - ./clickhouse-config.xml:/etc/clickhouse-server/users.d/low_memory.xml
```

`clickhouse-config.xml`:
```xml
<clickhouse>
  <profiles>
    <low_memory>
      <max_memory_usage>800000000</max_memory_usage>            <!-- 800MB per query -->
      <max_server_memory_usage>1200000000</max_server_memory_usage> <!-- 1.2GB total -->
    </low_memory>
  </profiles>
</clickhouse>
```

---

## 4. 组件设计

### 4.1 Plausible(采集 + 主看板)

- **角色**:接收 client 心跳与 L4-lite 事件;提供 DAU/版本/国家分布看板
- **部署**:官方 self-host docker-compose,加我们的 ClickHouse 内存补丁
- **域名**:`telemetry.deskfox.ai`(对外)
- **管理后台访问**:**不暴露公网**,通过 SSH 隧道 `ssh -L 8000:localhost:8000` 本地访问
  - 折中:仅事件接收路径 `/api/event` 公开,管理 UI `/` 加 nginx basic auth
- **数据保留**:24 个月(Plausible 默认无限,需配 retention job)

### 4.2 Update endpoint(静态 JSON)

最简方案:nginx 直接 serve `/var/www/updates/`,无后端服务。

文件结构:
```
/var/www/updates/
├── desktop/
│   ├── latest.yml          # electron-updater 标准格式(macOS/Windows/Linux 各一份)
│   ├── latest-mac.yml
│   ├── latest-linux.yml
│   └── opencode-1.2.3.dmg  # 或仅 redirect 到 OSS
├── cli/
│   └── latest.json         # 自定义,见 §7.2
└── _meta/
    └── released_at.txt     # 发布时间戳,便于诊断
```

> **替代方案**:把更新文件直接托管在 OSS,Tokyo 仅放 `latest.json` 索引指向 OSS URL。**推荐**:索引在 Tokyo,二进制在 OSS — 走 CDN 加速下载,本机省带宽。

### 4.3 Grafana(二次看板)

- **角色**:做 Plausible 看板覆盖不到的视图(L4 事件趋势、版本升级速度、关闭率)
- **数据源**:只读连接 Plausible 的 PostgreSQL + ClickHouse
- **认证**:Grafana 自带,管理员账号通过 1Password 共享
- **暴露**:`grafana.deskfox.ai` + nginx basic auth 双重锁

### 4.4 Nginx(在现有配置上增量)

**新增 `/etc/nginx/sites-available/opencode-telemetry`**(示意):

```nginx
# Plausible 反代
server {
    listen 443 ssl http2;
    server_name telemetry.deskfox.ai;

    ssl_certificate /etc/letsencrypt/live/telemetry.deskfox.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/telemetry.deskfox.ai/privkey.pem;

    # 仅事件接收开放
    location ~ ^/(api/event|js/script.js)$ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Host $host;
        # 防刷
        limit_req zone=event_zone burst=20 nodelay;
    }

    # 管理 UI 加 basic auth
    location / {
        auth_basic "Restricted";
        auth_basic_user_file /etc/nginx/.htpasswd-plausible;
        proxy_pass http://127.0.0.1:8000;
    }
}

# Updates 静态
server {
    listen 443 ssl http2;
    server_name updates.deskfox.ai;

    ssl_certificate /etc/letsencrypt/live/updates.deskfox.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/updates.deskfox.ai/privkey.pem;

    root /var/www/updates;

    location / {
        try_files $uri $uri/ =404;
        add_header Cache-Control "no-cache, must-revalidate" always;
        limit_req zone=update_zone burst=10 nodelay;
    }
}

# Rate limit zones (放在 nginx.conf http 块)
# limit_req_zone $binary_remote_addr zone=event_zone:10m rate=60r/m;
# limit_req_zone $binary_remote_addr zone=update_zone:10m rate=30r/m;
```

---

## 5. 客户端 SDK 设计

### 5.1 CLI(`packages/opencode`)

新增模块:`src/telemetry/`

```
src/telemetry/
├── index.ts              # 公共 API: track(event) / heartbeat() / checkUpdate()
├── install_id.ts         # 读/写 ~/.config/opencode/install_id (UUID v4, 600 perm)
├── config.ts             # opt-out 解析:env / config / 默认开
├── transport.ts          # fetch + 指数退避 + 5min 缓冲
└── update_check.ts       # GET /v1/latest/cli
```

**关键行为**:
- 启动时 `await firstRunNoticeIfNeeded()` — 仅打印一次告知到 stderr
- 后台 `void heartbeat()` — 不阻塞
- 命令结束时 `flush()` — 把缓冲事件批量发出
- `await checkUpdate()` 结果缓存 24h(`~/.cache/opencode/update_check.json`)

**核心事件清单(已确认)**:
| 事件名 | 触发点 |
|---|---|
| `cli.session_start` | 进程启动 |
| `cli.tool_run` | 任意工具调用(如 Read/Edit/Bash)— 仅计数,不带文件名 |
| `cli.error` | 未捕获异常 |
| `cli.command_completed` | 一个 prompt 完成 |
| `cli.upgrade_seen` | 升级提示成功展示 |

### 5.2 桌面 Electron(`packages/desktop-electron`)

新增依赖:`electron-updater`(主进程)+ 复用 CLI 的 `telemetry` 模块。

**主进程**:
```typescript
// src/main.ts
import { autoUpdater } from "electron-updater"
autoUpdater.setFeedURL({ provider: "generic", url: "https://updates.deskfox.ai/desktop" })
autoUpdater.checkForUpdatesAndNotify()
// 启动 + 每 24h 一次
```

**关键事件**(L4-lite):
| 事件名 | 触发点 |
|---|---|
| `desktop.app_open` | 主窗口创建 |
| `desktop.project_open` | 用户打开项目 |
| `desktop.ai_request` | 发起一次 AI 调用 — 仅计数 |
| `desktop.update_downloaded` | 自动更新下载完成 |
| `desktop.update_applied` | 重启应用更新 |

**首启告知卡片**:首次启动展示模态弹窗,3 选项:
1. 允许并继续(默认聚焦)
2. 关闭统计但继续
3. 阅读隐私政策(打开浏览器)

### 5.3 Web(`packages/app`)

最简:嵌入 Plausible 的 `script.js`(已通过 `telemetry.deskfox.ai/js/script.js` 反代)。

```html
<script defer data-domain="opencode.app"
        src="https://telemetry.deskfox.ai/js/script.js"></script>
```

custom event 通过 `window.plausible('event_name')` 触发。无须自定义 SDK。

---

## 6. 数据模型与事件 schema

### 6.1 心跳事件(Plausible "pageview" 借用)

Plausible 用 pageview 做 DAU 统计 — 我们把"启动"映射成一个虚拟 pageview:

```http
POST /api/event HTTP/1.1
Host: telemetry.deskfox.ai
User-Agent: opencode-cli/1.2.3 (linux; x64; install=550e8400)
Content-Type: application/json

{
  "name": "pageview",
  "url": "app://launch",
  "domain": "opencode.<client_type>",
  "props": {
    "version": "1.2.3",
    "os": "linux",
    "arch": "x64",
    "install_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

> **install_id 在 props 而不是 IP** — Plausible 默认按 IP+UA 日级 hash,这够用作 DAU。`install_id` 仅在 props 里供 Grafana 分析跨日留存使用。

### 6.2 L4-lite 事件

```http
POST /api/event HTTP/1.1

{
  "name": "cli.tool_run",
  "url": "app://event",
  "domain": "opencode.cli",
  "props": {
    "version": "1.2.3",
    "install_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

> ❌ **绝不发送**:文件路径、prompt 内容、模型名(model-name 是个边界,默认不发,如果想统计模型使用率再单开 OQ)

---

## 7. API 契约

### 7.1 POST `/api/event`(Plausible 原生)

由 Plausible 处理,我们不自己实现。客户端按 Plausible 协议构造请求即可。

### 7.2 GET `/v1/latest/cli`(自定义)

**请求**:无 body。

**响应**(`/var/www/updates/cli/latest.json`):
```json
{
  "version": "1.2.3",
  "released_at": "2026-04-29T03:14:00Z",
  "min_supported_version": "1.0.0",
  "upgrade_commands": {
    "npm":  "npm i -g opencode@latest",
    "bun":  "bun add -g opencode@latest",
    "brew": "brew upgrade opencode",
    "curl": "curl -fsSL https://updates.deskfox.ai/cli/install.sh | bash"
  },
  "release_notes_url": "https://github.com/.../releases/tag/v1.2.3",
  "is_security_update": false
}
```

**版本比较**:客户端使用 `semver` 库,`semver.gt(remote.version, local.version) === true` 时显示提示。

### 7.3 GET `/v1/latest/desktop/latest.yml`(electron-updater)

完全遵循 electron-updater 标准格式 — 由 electron-builder 打包时自动生成,我们只负责 SCP 上传到 `/var/www/updates/desktop/`。

---

## 8. 隐私与 opt-out 实现

### 8.1 三个等价开关(协同优先级)

```
最高优先 → 最低优先
  ENV: OPENCODE_TELEMETRY=0
  CLI flag: --no-telemetry  (临时关一次会话)
  Config:   ~/.config/opencode/config.json { "telemetry": false }
  Default:  true(默认开)
```

任意一个关 → 整个 telemetry 模块短路,所有 fetch 不发起。

### 8.2 升级检查独立开关

`OPENCODE_UPDATE_CHECK=0` 单独关闭升级检查。即使 telemetry 关闭,默认仍然检查升级(因为是用户利益)。除非两个都关。

### 8.3 首启告知

CLI:
```
opencode collects anonymous usage stats (version, OS, country, command counts)
to improve the project. No code, prompts, or identity is sent.
Disable: export OPENCODE_TELEMETRY=0  ·  Privacy policy: https://...
(This message will not appear again.)
```

桌面:首次启动模态弹窗,样式见 §5.2

Web:首次访问顶部 banner,带 X 按钮关闭(服务端 cookie 记忆 6 月)

### 8.4 数据保留

- Plausible:24 月(配 retention job)
- nginx access log:30 天(已通过 logrotate 默认配置)
- ClickHouse 行级 TTL:`event_date + INTERVAL 24 MONTH` 自动清理

---

## 9. 部署计划

### 9.1 服务端(Tokyo)

**Phase 0:基础设施(已完成 ✅)**:
- ✅ swap 2GB
- ✅ journald 限制 500M

**Phase 1:Plausible 起服**(预计 2 小时)
1. 申请域名 + DNS A 记录指向 52.197.46.120(OQ-A)
2. certbot 申请 3 个证书
3. 部署 Plausible docker-compose(含 ClickHouse 内存补丁)
4. nginx 加新 vhost,配 rate limit
5. 烟测:`curl -X POST https://telemetry.deskfox.ai/api/event ...`

**Phase 2:Update endpoint**(预计 30 分钟)
1. 创建 `/var/www/updates/{cli,desktop}/`
2. 放置初始 `latest.json` / `latest.yml` 占位
3. nginx vhost 上线

**Phase 3:Grafana**(预计 1 小时)
1. docker-compose 加 grafana service
2. 创建只读 PostgreSQL 用户给 Grafana
3. 配 nginx basic auth + vhost

### 9.2 客户端

**Phase 4:CLI 集成**(预计 1 天)
- 实现 `src/telemetry/`
- 单测覆盖 opt-out 三种路径
- E2E:启动 → 看到事件落到 Plausible

**Phase 5:桌面集成**(预计 1.5 天)
- electron-updater 接入
- 首启告知 UI
- 在 macOS / Windows / Linux 三平台各跑一遍自更新流程
- **依赖**:OQ-B(代码签名证书)

**Phase 6:Web 集成**(预计 2 小时)
- 注入 Plausible 脚本
- 加 banner 组件

### 9.3 CI/CD

每次 release 时(GitHub Actions):
1. 构建产物上传到阿里云 OSS(已有流程,不变)
2. 生成 `latest.yml`(electron-builder)与 `latest.json`(自写脚本)
3. SCP 到 Tokyo `/var/www/updates/`
4. 触发 GitHub Release page 自动通过 Plausible 记录一次"release published"事件

```yaml
# .github/workflows/release.yml(片段)
- name: Push update manifests to Tokyo
  run: |
    scp -i $TOKYO_KEY \
      dist/latest*.yml \
      ubuntu@52.197.46.120:/var/www/updates/desktop/
    scp -i $TOKYO_KEY \
      dist/cli-latest.json \
      ubuntu@52.197.46.120:/var/www/updates/cli/latest.json
```

---

## 10. 运维关切

### 10.1 内存预算复核

| 项 | 内存 |
|---|---|
| 系统 + 现有服务 | ~800 MB |
| Plausible 栈(含 PG + CH 限 1.2G) | 2100 MB |
| Grafana | 200 MB |
| 余量 | ~700 MB |
| swap | 2048 MB(应急) |

突发场景下若内存不够,kswap 会用 swap,**不会 OOM**。但若长期触发 swap → 升级到 4GB Lightsail 实例(月增 ~$10)

### 10.2 备份

| 数据 | 频率 | 介质 |
|---|---|---|
| PostgreSQL(用户/配置) | 日 | rsync 到 OSS,保留 30 天 |
| ClickHouse(事件) | 周(全量小,事件按月分区) | 同上 |
| `/etc/nginx/sites-available/` | 改动后 | git(私有仓) |
| `/var/www/updates/` | 改动后 | 不需要(由 release pipeline 重建) |

### 10.3 监控自身

复用 Grafana。最小看板:
- CPU / 内存 / disk / swap 使用率
- 每个端点 4xx/5xx 计数(从 nginx access log 解析)
- Plausible / ClickHouse / PG 容器存活

告警先不做(Phase 2),PoC 阶段人工巡检即可。

---

## 11. 滚动发布计划

| 阶段 | 范围 | 验收标志 |
|---|---|---|
| α | 仅维护者机器(2 人) | 两人能从 Plausible 看到自己的心跳 |
| β | 内部 5 人 | DAU 看板正确显示 5 |
| γ | 公开版本(默认开 telemetry) | 第一周内确认 country 分布、版本分布合理,无投诉 |

每阶段间隔 ≥ 3 天,允许回退。回退方式:client 端发布禁用 telemetry 的小版本,服务端不动。

---

## 12. 已解决的遗留问题(2026-04-29 review 确认)

- **OQ-A** ✅ 域名 `deskfox.ai`(泛解析)→ 子域 `telemetry.deskfox.ai` / `updates.deskfox.ai` / `grafana.deskfox.ai`
- **OQ-B** ✅ **Phase 1 零证书方案**(详见 §15)
- **OQ-C** ✅ L4 事件清单按 §5.1 / §5.2 敲定
- **OQ-D** ✅ 新建 workspace package `packages/telemetry`,三客户端依赖

## 12.1 进入 Phase 2 时再决策

- **OQ-E** **L4 事件能否精准跨日去重**:Plausible 不原生支持 install_id 跨日唯一计数。若 G2 需要"周活/月活精确数",Phase 2 需补一个轻量 collector 写 PG。Phase 1 先用 Plausible 近似值
- **OQ-F** **port 3000 (new-api) 公网暴露**:与本设计无关,巡检时发现,建议另开 issue 跟进
- **OQ-G** **未来代码签名补齐**:Apple Developer $99/年 + Azure Trusted Signing $10/月,补后可全平台静默自更新

---

## 13. 设计决策摘要

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| DD-1 | Plausible self-host | PostHog / 自研 | 资源约束 + 隐私友好 + 看板开箱 |
| DD-2 | ClickHouse 限内存 1.2G | 默认无限 | 2C4G + 多服务共存 |
| DD-3 | Update endpoint 走静态 JSON | 自写后端 | 0 运维成本,nginx 缓存友好 |
| DD-4 | 二进制托管 OSS,索引在 Tokyo | 全部 Tokyo | 节省 Tokyo 带宽,中国用户走 CDN |
| DD-5 | Plausible 管理 UI 仅 basic auth | 完全内网 | 维护者远程查看便利 |
| DD-6 | 共用一个 telemetry package | 三个客户端各自实现 | DRY,opt-out 行为一致 |
| DD-7 | 默认开 + 显著告知 | 默认关 | 数据完整性 + 社区惯例可接受 |

---

## 14. 下一步

1. 实施工作流见 `docs/workflow-telemetry-and-update.md`
2. 按工作流 Phase 顺序执行,跨阶段间至少留 3 天观察期

---

## 15. Phase 1 分平台分发策略(零证书方案)

| 平台 | 分发渠道 | 自动更新机制 | 用户首启体验 |
|---|---|---|---|
| **Windows** | **微软商店 (DeskFoxAI)** | 商店原生(无需代码签名,微软自动签) | 完全无感 |
| **macOS** | 官网下载 `.dmg`(无签名) | ❌ 无静默自更新;启动时检查新版,弹"有新版,点此下载"对话框 | 首启需右键"打开"绕过 Gatekeeper(README 指引) |
| **Linux** | AppImage / `.deb`(自打包) | electron-updater(AppImage 不需要签名) | 完全无感 |

**实施变化**(相对原 §3 / §5.2):
- §5.2 桌面端的 `electron-updater.setFeedURL` 仅对 **Linux** 启用
- macOS / Windows 商店外渠道:实现一个 `manualUpdateCheck()` — 启动时打 `https://updates.deskfox.ai/desktop/latest.json`,有新版弹原生对话框,点击后 `shell.openExternal()` 打开下载页
- Windows 微软商店渠道完全不集成 electron-updater(商店会接管)
- README 增加"macOS 首启 Gatekeeper 处理"段落,中英双语

**Phase 2 升级路径**:补 Apple Developer($99/年)→ macOS 启用静默自更新 + 公证;补 Azure Trusted Signing($10/月)→ 商店外 Windows 渠道也获得签名
