# opencode-prod 部署（生产）

自研 opencode-tools 镜像（`stable` 标签，验证后手动前移），`serve --port 4097`，host 网络，`restart: unless-stopped`。

`opencode.jsonc` / `AGENTS.md` 已烘进镜像（见 `Dockerfile.tools`），部署目录只需涉密文件。

## 部署目录结构

```
deploy/
├── compose.yml          # 本模板
├── .env                 # 从 .env.example 复制后填值（600 权限，不进仓库）
└── config/
    └── home/
        ├── .aliyun/     # 阿里云凭证（只读挂载）
        └── .oci/        # OCI 凭证 + 私钥（只读挂载）
```

数据在命名卷 `prod-data`（会话 DB）、`prod-work`（/workspace）里，由 compose 自动创建。

## 启动 / 停止

```
cp docker/.env.example .env   # 填值，chmod 600 .env
docker login swr.cn-north-9.myhuaweicloud.com   # 新机器拉镜像前先登录（GHCR 同理）
docker compose up -d
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4097/
docker compose down   # 停机（卷保留，数据不丢）
```

## .env 配置项

- `LITELLM_BASE_URL` / `LITELLM_API_KEY`：模型网关
- `GH_TOKEN`：GitHub
- `OPENCODE_SERVER_PASSWORD`：Web 登录密码
- `CLOUDFLARE_API_TOKEN`
- `HCLOUD_AK` / `HCLOUD_SK`：华为云（entrypoint 内自动 configure）
- `SMTP_HOST` / `SMTP_PORT`(默认587) / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `MAIL_DEFAULT_TO`(可选)：邮件通知（msmtp 经 SMTP 发信，密码/授权码不进镜像）

## 邮件通知（V1：msmtp）

`send-mail` 已烘进 tools 镜像（见 `Dockerfile.tools` + `docker/send-mail.sh`），配置走 `.env`，agent 与 cron 通用：

```
# .env 里填好 SMTP_* 后重启容器生效（chmod 600 .env）
send-mail "对方@xxx.com" "主题" "正文"
send-mail "a@x.com,b@x.com" "主题" "正文"          # 多个收件人逗号分隔
echo "长正文..." | send-mail "对方@xxx.com" "主题"  # 管道正文
send-mail "对方@xxx.com" "主题" -f /workspace/report.txt
```

说明：465 端口走隐式 TLS，其余端口走 STARTTLS；QQ/163/Gmail 用授权码而非登录密码；缺配置时命令会明确报错缺哪个变量。

## 备份 / 恢复（带历史）

```
docker compose down
docker run --rm -v opencode-prod_prod-data:/d -v ./backup:/b alpine tar czf /b/prod-data-$(date +%F).tgz -C /d .
docker run --rm -v opencode-prod_prod-work:/w -v ./backup:/b alpine tar czf /b/prod-work-$(date +%F).tgz -C /w .
# 恢复：先 up -d 建空卷，再解包进去，最后 restart
docker run --rm -v opencode-prod_prod-data:/d -v ./backup:/b alpine tar xzf /b/prod-data-XXX.tgz -C /d
docker compose restart
```

## 浏览器 sidecar（agent-browser CLI + 独立 browser 容器，CDP 连接）

`agent-browser` CLI 已烘进 tools 镜像（见 `Dockerfile.tools`，pin 版本，只装 CLI 不装 Chrome）。
浏览器跑在独立的 `browser` 服务里（默认自研 chrome-cjk：headless-shell + 中文字体），经 CDP 连：

```
# 浏览器是否在线（opencode 容器内执行）
curl -s http://browser:9222/json/version
# 宿主机调试用（只绑回环）
curl -s http://127.0.0.1:9222/json/version

# agent 用法（每次必带 --cdp；先拉配套说明，不要靠记忆）
agent-browser skills get core
agent-browser --cdp "$BROWSER_CDP_URL" open https://example.com
agent-browser --cdp "$BROWSER_CDP_URL" snapshot -i
```

说明：

- compose 已切 bridge 网络（`opencode-net`），容器间用服务名寻址（`browser:9222`）。
- bridge 下容器 `localhost` 不再是宿主机：跑在宿主机上的服务（如 LiteLLM 网关）请用
  `http://host.docker.internal:<port>`（`.env` 里 `LITELLM_BASE_URL` 不要填 `127.0.0.1`）。
- `browser` 服务要 `shm_size: 2gb` + `init: true`（headless-shell 官方要求，否则崩溃/僵尸进程）。
- 浏览器镜像同样走 digest pin 跟版（`BROWSER_IMAGE=...@sha256:...`），与 tools 镜像同流程。
- 禁止在 tools 镜像里 `agent-browser install`（Chrome 只来自 sidecar，不进 tools 镜像）。

## 跟版

改 `compose.yml` 里 `image:` 的 digest 一行并提交，`docker compose pull && docker compose up -d`。`stable` 标签只在验证后手动前移（标记作用）。


## 生产事故 2026-10-09：runner 黑户工具

- 现象：guard-rules 的 Sync 用新容器跑出 wrangler command not found；此前 3 次成功。oci 的 job 缺 pip。
- 根因：旧 runner 容器用官方 stock 镜像，有人 docker exec 进容器手工装了 wrangler——没进 Dockerfile、没进流水线。迁移删容器时工具一起陪葬；pip 则是 stock 镜像本来就没有。

## 铁律：环境变更必须进镜像流水线

1. 禁止 docker exec 进运行容器装软件/改配置来修问题——当时能跑，删容器即复发，其他机器永远复现不了。
2. 运行环境的一切变更（加 CLI、改配置、装依赖）必须写进 Dockerfile，经 CI 构建 → digest pin → test 回归 → stable 封版，与 opencode-tools 同流程。
3. 新机器只用 仓库 compose + 镜像 digest + .env 启动，不接受任何手工前置步骤。
4. 删容器前默认假设里面可能有黑户：先查历史 job 日志确认工具链，重建后跑回归验证再交工。
