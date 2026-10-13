# 生产环境说明（直连模型）

本容器内各云 CLI 已直接配好凭证。需要查云资源时直接在容器内执行对应 CLI。不要向用户索取任何密钥。所有查询优先只读。执行变更类操作前必须先向用户确认。

可用工具：

- 铁律：所有源在国外的下载/拉取（GitHub release、ghcr.io 镜像、外网文件、pip/npm/go 等境外源），一律优先走 `url2hc` 中转，禁止直连硬扛。直连只有当中转失败或不适用时才允许。
- 文件到 OBS：`gh workflow run download-to-obs.yml --repo link-seek/url2hc -f url="<下载地址>" -f obs_key="<文件名>"`，日志里拿 7 天预签名链接（文件 7 天自动删）。
- 镜像到 SWR：`gh workflow run img-to-swr.yml --repo link-seek/url2hc -f source_image="ghcr.io/xxx:tag"`，自动公开 + 7 天老化，拉取地址 `swr.cn-north-4.myhuaweicloud.com/link-seek/<名>:<标签>`（SWR 在 cn-north-4，跨区只能公网拉）。
- Dockerfile 云端构建：`gh workflow run build-to-swr.yml --repo link-seek/url2hc -f target_name="<名>" -f dockerfile_inline="$(cat Dockerfile)"`。
- `gh repo list --limit 10`：查看 GitHub 仓库
- `hcloud ECS ListServersDetails --limit 5 --cli-region=cn-north-4`：华为云华北四区 ECS
- `aliyun ecs DescribeInstances --RegionId cn-hangzhou`：阿里云杭州地域实例
- `oci compute instance list --compartment-id <ocid> --all`：甲骨文云实例
- `tailscale status`：查看 tailnet 节点状态

浏览器自动化（`agent-browser` CLI 已烘入镜像 + 独立 `browser` sidecar，经 CDP 连接；浏览器不在本镜像内）：

- 每次调用必须带 `--cdp "$BROWSER_CDP_URL"`（默认 `http://browser:9222`，compose 服务名即地址）。
- 动手前先拉与安装版本配套的用法：`agent-browser skills get core`（不要靠记忆拼命令）。
- 典型流程：`agent-browser --cdp "$BROWSER_CDP_URL" open <url>` → `snapshot -i` → `click @e2` / `fill @e3 "文本"` → `screenshot` → `close`。
- 先确认浏览器在线：`curl -s http://browser:9222/json/version`。
- 禁止在本容器内运行 `agent-browser install`（Chrome 由 browser sidecar 提供，不要装进 tools 镜像）。

邮件通知（`send-mail` + msmtp 已烘入镜像，SMTP 配置走 `.env` 的 `SMTP_*`，密钥不进镜像）：

- `send-mail <收件人> <主题> <正文>`：收件人多个用逗号分隔，如 `send-mail "a@x.com,b@x.com" "主题" "正文"`。
- 正文长时：`echo "..." | send-mail <收件人> <主题>` 或 `send-mail <收件人> <主题> -f <文件>`。
- 用户说“发邮件给我/他”时直接用此命令；长任务完成或失败后主动发一封告知结果；定时巡检（宿主机 cron/systemd 调 `opencode run`）输出摘要后发。
- 用户的默认邮箱是 xieyucheng@outlook.com：用户说“发给我”又没给地址时直接发这里，不用再问；`MAIL_DEFAULT_TO` 已配好，收件人传空字符串即走默认，如 `send-mail "" "主题" "正文"`。
- 发前确认收件人正确；缺配置时按报错补 `.env` 后重启容器生效，不要向用户索取密码。

工作区说明：

- `/workspace` 为默认工作目录（git 仓库，改动前会自动 checkpoint）。
- 若挂载了 `/old-workspace`，那是历史业务目录，优先只读；需要改动必须先向用户确认。
- 模型经由本地 LiteLLM 网关调用。不要在容器内改动 `/root/.config/opencode/` 下的文件（随容器重建丢失）；要改默认配置请改镜像仓库重打镜像。

- 铁律：运行环境缺工具时，禁止在容器内手工安装——去仓库 Dockerfile 加、走流水线重打镜像（2026-10-09 runner 黑户事故教训，详见 docker/README.md）。
