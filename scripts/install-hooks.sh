#!/usr/bin/env bash
# ============================================================
# opencode-fork hook 安装/验证脚本
#
# 背景：upstream 用 husky 管 hooks（package.json "prepare": "husky"），
# `bun install` 时自动装。本脚本只做验证 + 一次性兜底。
#
# 用法：
#   bash scripts/install-hooks.sh          # 验证 + 修复
# ============================================================

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> 检查 husky 是否已装（应在 bun install 时由 prepare 钩子自动装）"
if [ ! -d ".husky/_" ]; then
  echo "⚠️  .husky/_ 不存在，husky 还没初始化。请先跑 bun install。"
  echo "   如果已经 bun install 过：bunx husky"
  exit 1
fi

echo "==> 检查 .husky/pre-commit"
if [ ! -f ".husky/pre-commit" ]; then
  echo "❌ .husky/pre-commit 缺失。fork 自带的护栏脚本应该在这里。"
  echo "   可能被 git checkout 覆盖。请从 git 恢复："
  echo "   git checkout HEAD -- .husky/pre-commit"
  exit 1
fi

if [ ! -x ".husky/pre-commit" ]; then
  echo "==> 修复 .husky/pre-commit 可执行权限"
  chmod +x .husky/pre-commit
fi

echo "==> 验证 git config core.hooksPath"
HOOKS_PATH=$(git config core.hooksPath || echo "")
if [ "$HOOKS_PATH" != ".husky/_" ] && [ "$HOOKS_PATH" != ".husky" ]; then
  echo "⚠️  core.hooksPath = '$HOOKS_PATH'（期望 '.husky/_' 或 '.husky'）"
  echo "   重新跑：bunx husky"
fi

echo "==> 测试 pre-commit 脚本能跑（dry-run）"
if bash -n .husky/pre-commit; then
  echo "✅ pre-commit 语法 OK"
else
  echo "❌ pre-commit 语法错误"
  exit 1
fi

echo ""
echo "✅ hook 安装/验证完成。"
echo "下次 git commit 时会自动跑 .husky/pre-commit（含白名单/diff阈值/大小写检查）"
