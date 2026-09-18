# MUC Harness 生产部署报告（PRODUCTION_DEPLOYMENT_REPORT）

> 部署完成：2026-09-18 · 生产地址：admin.wuxuexi.top（112.125.88.123）
> 镜像：`sub2api-muc:20260918-5e908826`（linux/amd64，宿主机交叉编译 + 轻量组装）

## 1. Production Host
- 阿里云 ECS `iZ2zebuq73i77n97j13o78Z`，Alibaba Cloud Linux 8，**x86_64**
- SSH：`ssh -i ~/.ssh/id_ed25519 admin@112.125.88.123`（密钥免密）
- Docker：可用（`sudo docker`），compose v2

## 2. DNS / Proxy Topology
- 权威 A 记录（Cloudflare DoH 验证）：`admin.wuxuexi.top → 112.125.88.123`，无 CNAME
- 本机解析 `198.18.0.55` 为代理工具 fake-ip（**不得作为真实地址**）
- 域名流量经用户代理到达源站 nginx

## 3. Container Topology
```
nginx 1.24（宿主机，/etc/nginx/conf.d/sub2api-admin.conf）
  admin.wuxuexi.top:80 → proxy_pass 127.0.0.1:8080（X-Forwarded-Proto: http）
    → Docker: sub2api（127.0.0.1:8080→8080）
        ├─ sub2api-postgres（postgres:18-alpine）
        └─ sub2api-redis（redis:8-alpine）
  compose：/srv/sub2api/docker-compose.yml（数据卷 /srv/sub2api/data → /app/data）
```

## 4. Old Image
- `weishaw/sub2api:latest`（上游 v0.2.5，commit 86f93c28）
- 回滚镜像已打标签：`sub2api:rollback-20260918-1642`
- 镜像 ID 存档：服务器 `/home/admin/sub2api-old-image.txt`

## 5. New Image
- `sub2api-muc:20260918-5e908826`（不可变 tag；git short sha 5e908826 = MUC Harness 部署 commit）
- 本机留存：`docker images sub2api-muc`

## 6. Architecture
- 生产服务器 x86_64 → 镜像 **linux/amd64**（`docker image inspect` 核对通过）
- 组装方式：宿主机交叉编译（CGO_ENABLED=0 GOOS=linux GOARCH=amd64，`-tags embed` 内嵌前端）
  → 组装素材 scp 至服务器 → 服务器原生 `docker build`（规避 colima arm64 跨架构构建限制）

## 7. Data Volumes（未动）
- `/srv/sub2api/data → /app/data`（新增子目录 `/srv/sub2api/data/downloads/`）
- PostgreSQL/Redis 容器与卷：全程未重启、未清空（Redis 仅执行过一次 FLUSHDB 清鉴权缓存残留，见 §8）

## 8. Database Backup
- `pg_dump`：服务器 `/home/admin/sub2api-backup-20260918-1642.sql`（1.4MB，切换前完成）

## 9. Migration Audit
- `86f93c28..HEAD`：**无新增/修改的数据库迁移文件**（详见 `docs/PRODUCTION_MIGRATION_AUDIT.md`）
- 升级过程零迁移执行；回滚无数据库恢复需求

## 10. Deployment Commands（实际执行）
```
# 素材传输 + 服务器构建
scp -r mucode-server resources docker-entrypoint.sh Dockerfile admin@…:/home/admin/mucode-deploy/
sudo docker build -t sub2api-muc:20260918-5e908826 -f Dockerfile .
# 备份
pg_dump → /home/admin/sub2api-backup-20260918-1642.sql；旧镜像 tag rollback-20260918-1642
# 切换
sudo sed -i 添加 SUB2API_IMAGE=sub2api-muc:20260918-5e908826 → /srv/sub2api/.env
sudo docker compose up -d --no-deps sub2api
```
注：生产 compose 的镜像变量为 `${SUB2API_IMAGE:?}`，插值读取 `/srv/sub2api/.env`（`.env.deploy` 不参与插值）。

## 11. Health Checks（切换后）
- `docker inspect` health: **healthy**
- `GET /health`（healthcheck 内部探活）：通过
- 首页/登录页/`/muc`：200

## 12. Legacy Regression Tests
| 项 | 结果 |
|---|---|
| 首页 / 登录页 / `/muc` | 200 ✅ |
| 真实 Key（自用主Key）`GET /v1/models` | **200**，返回智谱分组真实模型（chatglm_lite/pro 等）✅ |
| 管理后台（用户截图确认） | 正常 ✅ |
| 数据库 schema | 无 migration 执行（审计见 §9）✅ |

## 13. MUC E2E
- 服务端：`exchange{}` → 400（参数校验）；`connect-code` 未登录 → 401 ✅
- 客户端全链路（连接→凭据→模型同步→重启持久→断开清除）：已在 mucode.app 本机验证 ✅
- **真实账号一键连接**（网站登录 → code → mucode）：待用户在浏览器执行一次（账号在用户侧，无法代操作）

## 14. Download Tests
| 文件 | 大小 | 127.0.0.1:8080 | admin.wuxuexi.top/downloads |
|---|---|---|---|
| mucode-mac-arm64.dmg | 305,394,478 | 200 ✅ | 200 ✅（Content-Length 一致）|
| mucode-mac-x64.dmg | 236,697,276 | 200 ✅ | 200 ✅ |
| mucode-win-x64.exe | 199,270,886 | 200 ✅ | 200 ✅ |
SHA256 三方（本地源/服务器文件）一致。

## 15. Rollback Procedure
```
# 服务器上恢复旧镜像（已留 tag）
cd /srv/sub2api && sudo sed -i 's|^SUB2API_IMAGE=.*|SUB2API_IMAGE=sub2api:rollback-20260918-1642|' .env
sudo docker compose up -d --no-deps sub2api
```
数据库无需恢复（零 migration）。

## 16. Remaining Risks
1. **验收 N（真实推理）未闭环**：「智谱」分组需在管理后台配置模型白名单（当前 `/v1/models` 返回 chatglm_lite/pro —— 配置后 mucode 自动跟随）；上游可用性待确认。
2. **HTTP-only**：admin.wuxuexi.top 无 TLS。正式对外前需上 HTTPS（证书 + nginx 443 配置），并保持客户端默认网关（当前为 http，TLS 就绪后改回 https 常量）。
3. **EXE 元数据**：Windows 包未内嵌图标/版本信息（免 wine 权衡），功能无损。
4. **单实例部署**：生产为单容器单副本，重启存在秒级中断。
5. 旧 4 把 Key（opencode.json 里的 8d60/9235/3975/d99e）已失效——需在网站重新签发或使用「一键连接」自动签发的新 Key。
6. **上游官方 OpenCode Windows 桌面版（BETA）存在启动崩溃 bug**：报 `Cannot find module './windowsTerminal'`（其安装目录 `AppData\Local\Programs\@opencode-aidesktop`）。与 mucode 包无关（mucode 安装目录为 `Programs\mucode`）。如师生在 Windows 装了官方桌面版遇到此错，属上游缺陷；mucode 的 Windows 包安装目录不同，不受影响。
7. mucode Windows 包未在真机 Windows 上做过启动实测（本环境无 Windows）；NSIS 包为标准 electron-builder 产物，风险低。
