#!/bin/sh
# send-mail：经 msmtp 发邮件的薄包装，配置全走环境变量（不进镜像）。
# 环境变量（由 compose .env 注入）：
#   SMTP_HOST  SMTP_PORT（默认 587） SMTP_USER  SMTP_PASS  SMTP_FROM
#   MAIL_DEFAULT_TO（可选，缺省收件人兜底）
# 用法：
#   send-mail <收件人> <主题> [正文...]
#   echo "正文" | send-mail <收件人> <主题>
#   send-mail <收件人> <主题> -f <文件>
#   send-mail --help
# 收件人多个用逗号或空格分隔。缺配置时报错说明缺哪个变量。
set -eu

usage() {
  cat <<'EOF'
用法：
  send-mail <收件人> <主题> [正文...]
  echo "正文" | send-mail <收件人> <主题>
  send-mail <收件人> <主题> -f <文件>

收件人多个用逗号或空格分隔，如 "a@x.com,b@x.com"。
配置走环境变量：SMTP_HOST SMTP_PORT(默认587) SMTP_USER SMTP_PASS SMTP_FROM，MAIL_DEFAULT_TO 为缺省收件人。
EOF
}

# --help 不需要任何配置
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

TO="${1:-${MAIL_DEFAULT_TO:-}}"
SUBJECT="${2:-}"
shift 2 2>/dev/null || { usage >&2; exit 2; }

# 收件人逗号转空格（msmtp 接受多个收件人参数）
TO="$(printf '%s' "$TO" | tr ',' ' ')"
if [ -z "$TO" ]; then
  echo "send-mail: 缺少收件人（参数或 MAIL_DEFAULT_TO）" >&2
  exit 2
fi
if [ -z "$SUBJECT" ]; then
  echo "send-mail: 缺少主题" >&2
  exit 2
fi

# 正文来源：-f 文件 > 剩余参数 > stdin(非终端时)
BODY_FILE=""
if [ "${1:-}" = "-f" ]; then
  BODY_FILE="${2:-}"
  [ -n "$BODY_FILE" ] && [ -f "$BODY_FILE" ] || { echo "send-mail: 正文文件不存在: ${2:-}" >&2; exit 2; }
fi

# 必需配置检查（缺哪个报哪个）
missing=""
[ -n "${SMTP_HOST:-}" ] || missing="$missing SMTP_HOST"
[ -n "${SMTP_USER:-}" ] || missing="$missing SMTP_USER"
[ -n "${SMTP_PASS:-}" ] || missing="$missing SMTP_PASS"
[ -n "${SMTP_FROM:-}" ] || missing="$missing SMTP_FROM"
if [ -n "$missing" ]; then
  echo "send-mail: 缺少邮件配置:$missing（检查 compose .env 是否填好，容器需重建/重启生效）" >&2
  exit 2
fi
PORT="${SMTP_PORT:-587}"

command -v msmtp >/dev/null 2>&1 || { echo "send-mail: 镜像缺 msmtp（需重打包含 msmtp 的 tools 镜像）" >&2; exit 127; }

# 465 为隐式 TLS，其余端口用 STARTTLS
STARTTLS="on"
if [ "$PORT" = "465" ]; then
  STARTTLS="off"
fi

# 临时 msmtprc（600 权限，密码不进命令行/ps）
CFG="$(mktemp)"
chmod 600 "$CFG"
trap 'rm -f "$CFG"' EXIT INT TERM
cat >"$CFG" <<EOF
defaults
auth on
tls on
tls_starttls $STARTTLS
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile /tmp/msmtp.log
account default
host $SMTP_HOST
port $PORT
from $SMTP_FROM
user $SMTP_USER
password $SMTP_PASS
EOF
chmod 600 "$CFG"

# 组装邮件（stdin 正文避免参数过长；主题中文无需转码，msmtp 按 UTF-8 透传）
if [ -n "$BODY_FILE" ]; then
  {
    printf 'From: %s\n' "$SMTP_FROM"
    printf 'Subject: %s\n' "$SUBJECT"
    printf 'Content-Type: text/plain; charset=utf-8\n\n'
    cat "$BODY_FILE"
  } | msmtp -C "$CFG" -- $TO
elif [ "$#" -gt 0 ]; then
  {
    printf 'From: %s\n' "$SMTP_FROM"
    printf 'Subject: %s\n' "$SUBJECT"
    printf 'Content-Type: text/plain; charset=utf-8\n\n'
    printf '%s' "$*"
    printf '\n'
  } | msmtp -C "$CFG" -- $TO
else
  if [ -t 0 ]; then
    echo "send-mail: 缺少正文（给参数、-f 文件或管道 stdin）" >&2
    exit 2
  fi
  {
    printf 'From: %s\n' "$SMTP_FROM"
    printf 'Subject: %s\n' "$SUBJECT"
    printf 'Content-Type: text/plain; charset=utf-8\n\n'
    cat
  } | msmtp -C "$CFG" -- $TO
fi
