# MUC Harness 生产拓扑（Phase P0 审计）

> 审计时间：2026-09-18 · 方法：Cloudflare DoH 权威解析（绕过本地代理 fake-ip）+ SSH 实地核查
> 结论基于实测，非推断。

## DNS / 代理拓扑

| 项 | 值 |
|---|---|
| 权威 A 记录（DoH @cloudflare-dns.com） | `admin.wuxuexi.top → 112.125.88.123` |
| CNAME | 无 |
| 本机解析 | `198.18.0.55`（代理工具 fake-ip，**不可作为真实地址**）|
| 真实源站 | **112.125.88.123**（直连 Host 头验证 = 站点响应 ✓）|

## 生产服务器

| 项 | 值 |
|---|---|
| 主机 | 阿里云 ECS `iZ2zebuq73i77n97j13o78Z` |
| 系统 | Alibaba Cloud Linux 8 · kernel 5.10 · **x86_64** |
| 登录 | `ssh -i ~/.ssh/id_ed25519 admin@112.125.88.123`（密钥免密 ✓）|
| Docker | 可用（`sudo docker` 权限）|

## 请求链路

```
用户浏览器
  → nginx 1.24（服务器宿主机，/etc/nginx/conf.d/sub2api-admin.conf）
      server_name admin.wuxuexi.top :80
      proxy_pass http://127.0.0.1:8080（X-Forwarded-Proto http；gzip on）
  → Docker 容器 sub2api（weishaw/sub2api:latest，127.0.0.1:8080→8080）
  → PostgreSQL（sub2api-postgres, postgres:18-alpine）/ Redis（sub2api-redis, redis:8-alpine）
```

- TLS：**当前无**（443 未监听 HTTPS 内容）。`X-Forwarded-Proto: http`。
- 无 CDN/Tunnel（直连 A 记录）。

## 容器与持久化

| 容器 | 镜像 | 持久化 |
|---|---|---|
| sub2api | weishaw/sub2api:latest（上游 v0.2.5，commit 86f93c28）| `/srv/sub2api/data` → `/app/data` |
| sub2api-postgres | postgres:18-alpine | 独立卷 |
| sub2api-redis | redis:8-alpine | 独立卷 |
| compose | `/srv/sub2api/docker-compose.yml` | nginx 配置 `/etc/nginx/conf.d/sub2api-admin.conf` |

## 与本机环境的关系
本机 Docker（colima, 127.0.0.1:8080）是**独立的开发/预发栈**，与生产服务器互为镜像布局（同 compose 结构），但数据库互相独立。生产部署 = 将 linux/amd64 镜像传至 112.125.88.123 并在 `/srv/sub2api/` 切换。
