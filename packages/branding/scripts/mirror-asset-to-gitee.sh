#!/usr/bin/env bash
# DeskFox release 安装包附件上传到 Gitee(本地跑,国内网络秒传)
#
# Mac 端版本,逻辑跟 mirror-asset-to-gitee.ps1 完全对齐。
#
# 背景:GitHub US runner 上行 Gitee CN 被 GFW 节流,50MB 30 分钟传不完,
# 所以 .github/workflows/release-mirror-gitee-deskfox.yml 只镜像 Release 元数据,
# 安装包附件(.exe / .dmg)由 user 本地脚本上传 — 国内 IP 上 Gitee 是秒传级别。
#
# 用法:
#   1. 先跑一次 GitHub Release(`git push --tags` 触发 release-mac-deskfox.yml,
#      用 web UI publish draft → 触发 release-mirror-gitee-deskfox 创 Gitee release)
#   2. 等 ~1 分钟,确认 Gitee release 已建(https://gitee.com/zoulukuang/deskfox/releases)
#   3. 跑本脚本上传附件:
#        export GITEE_TOKEN="<your-gitee-pat>"   # 持久化建议写到 ~/.zshrc
#        bash packages/branding/scripts/mirror-asset-to-gitee.sh ship-mac-prod-2026.5.4.1
#
# 参数:
#   位置参数 1: tag,例 ship-mac-prod-2026.5.4.1
#   --asset <path>      手动指定上传文件路径(默认根据 tag 自动定位本地 .dmg)
#   --gitee-token <tok> 手动传 token(默认读环境变量 GITEE_TOKEN)
#   --gitee-owner       默认 zoulukuang
#   --gitee-repo        默认 deskfox

set -euo pipefail

# ─── color codes ────────────────────────────────────────────────────
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
RESET='\033[0m'

# ─── default args ──────────────────────────────────────────────────
TAG=""
ASSET=""
GITEE_TOKEN_ARG="${GITEE_TOKEN:-}"
GITEE_OWNER="zoulukuang"
GITEE_REPO="deskfox"
MAX_ASSET_SIZE=104857600  # 100 MB,Gitee 单文件上限
GITEE_API="https://gitee.com/api/v5"

# ─── parse args ────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --asset)
      ASSET="$2"; shift 2 ;;
    --gitee-token)
      GITEE_TOKEN_ARG="$2"; shift 2 ;;
    --gitee-owner)
      GITEE_OWNER="$2"; shift 2 ;;
    --gitee-repo)
      GITEE_REPO="$2"; shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | head -25
      exit 0 ;;
    -*)
      echo -e "${RED}[ERROR] 未知参数:$1${RESET}" >&2
      exit 1 ;;
    *)
      if [[ -z "$TAG" ]]; then
        TAG="$1"
      else
        echo -e "${RED}[ERROR] 多余的位置参数:$1(已有 tag=$TAG)${RESET}" >&2
        exit 1
      fi
      shift ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo -e "${RED}[ERROR] 缺位置参数 tag${RESET}" >&2
  echo "用法:$0 <tag> [--asset <path>] [--gitee-token <token>]"
  echo "示例:$0 ship-mac-prod-2026.5.4.1"
  exit 1
fi

# ─── 1. 校验 token ─────────────────────────────────────────────────
if [[ -z "$GITEE_TOKEN_ARG" ]]; then
  echo -e "${RED}[ERROR] 未提供 Gitee PAT。${RESET}" >&2
  echo "  方式 1:export GITEE_TOKEN='<your-pat>' 然后再跑本脚本"
  echo "  方式 2:$0 $TAG --gitee-token '<your-pat>'"
  echo ""
  echo "  Gitee PAT 获取:gitee.com/profile/personal_access_tokens(scope projects 即可)"
  echo ""
  echo "  持久化(macOS,zsh 默认):"
  echo "    echo 'export GITEE_TOKEN=\"<your-pat>\"' >> ~/.zshrc && source ~/.zshrc"
  exit 1
fi

# 探测 token 有效性
user_status=$(curl -s -o /tmp/gitee-user.json -w "%{http_code}" \
  --connect-timeout 30 --max-time 30 \
  "$GITEE_API/user?access_token=$GITEE_TOKEN_ARG" || echo "fail")
if [[ "$user_status" != "200" ]]; then
  echo -e "${RED}[ERROR] Gitee token 无效或过期(status=$user_status)${RESET}" >&2
  cat /tmp/gitee-user.json 2>/dev/null || true
  exit 1
fi
gitee_user=$(jq -r '.login' /tmp/gitee-user.json)
echo -e "${GREEN}[OK] Gitee token 有效,user=$gitee_user${RESET}"

# ─── 2. 自动定位 asset 文件 ─────────────────────────────────────────
if [[ -z "$ASSET" ]]; then
  # 从 tag 推 platform / env / version
  # ship-mac-prod-2026.5.4.1   → mac  prod  2026.5.4.1
  # ship-mac-beta-2026.5.10.1  → mac  beta  2026.5.10.1
  if [[ "$TAG" =~ ^ship-mac-(prod|beta)-(.+)$ ]]; then
    PLATFORM="mac"
    ENV_NAME="${BASH_REMATCH[1]}"
    VERSION="${BASH_REMATCH[2]}"
  elif [[ "$TAG" =~ ^ship-(prod|beta)-(.+)$ ]]; then
    echo -e "${RED}[ERROR] tag '$TAG' 是 Win release(ship-prod-* 没有 mac 前缀),Mac 脚本不处理。Win 端用 mirror-asset-to-gitee.ps1${RESET}" >&2
    exit 1
  else
    echo -e "${RED}[ERROR] 无法从 tag '$TAG' 推 platform/env/version,请用 --asset 手动指定${RESET}" >&2
    exit 1
  fi

  # Mac .dmg 默认路径(对齐 release-mac-deskfox.yml 的 build 产物路径 + 命名规则)
  CANDIDATE="packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox-${VERSION}_aarch64.dmg"

  if [[ ! -f "$CANDIDATE" ]]; then
    # 退路:从 GitHub Release 下载到 /tmp
    echo -e "${YELLOW}[INFO] 本地未发现 $CANDIDATE,从 GitHub Release 下载...${RESET}"
    TMP_DIR="/tmp/gitee-mirror-$TAG"
    mkdir -p "$TMP_DIR"
    if ! command -v gh >/dev/null 2>&1; then
      echo -e "${RED}[ERROR] gh CLI 未找到。安装:brew install gh && gh auth login${RESET}" >&2
      exit 1
    fi
    gh release download "$TAG" --repo "$GITEE_OWNER/$GITEE_REPO" --dir "$TMP_DIR" --clobber 2>&1 | head -20
    # 找下载下来的 .dmg
    CANDIDATE=$(find "$TMP_DIR" -name "*.dmg" -type f | head -n1)
    if [[ -z "$CANDIDATE" || ! -f "$CANDIDATE" ]]; then
      echo -e "${RED}[ERROR] GitHub Release 没找到 .dmg 附件${RESET}" >&2
      exit 1
    fi
  fi
  ASSET="$CANDIDATE"
fi

if [[ ! -f "$ASSET" ]]; then
  echo -e "${RED}[ERROR] 找不到 asset 文件:$ASSET${RESET}" >&2
  exit 1
fi

# 跨平台 file size:macOS BSD stat 用 -f%z,Linux GNU stat 用 -c%s,wc -c 是兜底
ASSET_SIZE=$(stat -f%z "$ASSET" 2>/dev/null || stat -c%s "$ASSET" 2>/dev/null || wc -c < "$ASSET" | tr -d ' ')
ASSET_NAME=$(basename "$ASSET")
ASSET_SIZE_MB=$(awk "BEGIN { printf \"%.2f\", $ASSET_SIZE / 1048576 }")

echo "[asset] $ASSET_NAME (${ASSET_SIZE_MB} MB)"

if [[ "$ASSET_SIZE" -gt "$MAX_ASSET_SIZE" ]]; then
  echo -e "${RED}[ERROR] 文件 ${ASSET_SIZE_MB} MB > 100MB Gitee 单文件上限,无法上传${RESET}" >&2
  exit 1
fi

# ─── 3. 找 Gitee release_id by tag ──────────────────────────────────
echo "[lookup] 在 Gitee 找 tag=$TAG 的 release..."
list_status=$(curl -s -o /tmp/gitee-releases.json -w "%{http_code}" \
  --connect-timeout 30 --max-time 30 \
  "$GITEE_API/repos/$GITEE_OWNER/$GITEE_REPO/releases?access_token=$GITEE_TOKEN_ARG&per_page=100")
if [[ "$list_status" != "200" ]]; then
  echo -e "${RED}[ERROR] 拉 Gitee releases 列表失败(status=$list_status)${RESET}" >&2
  cat /tmp/gitee-releases.json 2>/dev/null || true
  exit 1
fi

RELEASE_ID=$(jq -r --arg tag "$TAG" '.[] | select(.tag_name == $tag) | .id' /tmp/gitee-releases.json | head -n1)
if [[ -z "$RELEASE_ID" || "$RELEASE_ID" == "null" ]]; then
  echo -e "${RED}[ERROR] Gitee 上找不到 tag=$TAG 的 release。${RESET}" >&2
  echo "  确认 release-mirror-gitee-deskfox workflow 已 publish 触发并跑通"
  echo "  (workflow 触发后 ~30 秒 Gitee release 元数据就建好了)"
  echo "  GitHub draft 必须先 publish:gh release edit $TAG --repo $GITEE_OWNER/$GITEE_REPO --draft=false"
  exit 1
fi
echo -e "${GREEN}[OK] 找到 Gitee release id=$RELEASE_ID${RESET}"

# ─── 4. 检查附件是否已存在(去重)─────────────────────────────────
existing=$(jq -r --arg tag "$TAG" --arg name "$ASSET_NAME" \
  '.[] | select(.tag_name == $tag) | .assets[]? | select(.name == $name) | .name' \
  /tmp/gitee-releases.json | head -n1)
if [[ -n "$existing" ]]; then
  echo -e "${YELLOW}[skip] 附件 $ASSET_NAME 已在 Gitee release(可能上次已跑过)。${RESET}"
  echo "  Gitee URL: https://gitee.com/$GITEE_OWNER/$GITEE_REPO/releases/tag/$TAG"
  echo "  如要强制重传,先到 Gitee web 删旧附件再跑"
  exit 0
fi

# ─── 5. 上传(curl -F 走 multipart,本地 IP 上 Gitee 秒传)─────────
echo "[upload] 上传到 Gitee release_id=$RELEASE_ID..."
START_TIME=$(date +%s)

UPLOAD_URL="$GITEE_API/repos/$GITEE_OWNER/$GITEE_REPO/releases/$RELEASE_ID/attach_files"
RESP_FILE="/tmp/gitee-upload-resp-$$.json"

HTTP_CODE=$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
  --connect-timeout 30 --max-time 600 \
  -X POST "$UPLOAD_URL" \
  -F "access_token=$GITEE_TOKEN_ARG" \
  -F "file=@$ASSET")

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
[[ "$ELAPSED" -lt 1 ]] && ELAPSED=1

# 速率(Mbps):MB / s * 8
SPEED_MBPS=$(awk "BEGIN { printf \"%.2f\", $ASSET_SIZE_MB / $ELAPSED * 8 }")

echo "[upload done] http=$HTTP_CODE elapsed=${ELAPSED}s (${SPEED_MBPS} Mbps)"

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
  echo ""
  echo -e "${GREEN}✅ 上传成功!${RESET}"
  echo "Gitee release: https://gitee.com/$GITEE_OWNER/$GITEE_REPO/releases/tag/$TAG"
  rm -f "$RESP_FILE"
  exit 0
else
  echo ""
  echo -e "${RED}❌ 上传失败 http=$HTTP_CODE${RESET}" >&2
  echo "Gitee response:"
  cat "$RESP_FILE" 2>/dev/null || true
  rm -f "$RESP_FILE"
  exit 1
fi
