#!/bin/sh
set -e

LINK="/usr/bin/opencode-cli"

for dir in '/opt/OpenCode' '/opt/OpenCode Beta' '/opt/OpenCode Dev'; do
  target="${dir}/resources/opencode-cli"
  if [ -x "${target}" ]; then
    ln -sf "${target}" "${LINK}"
    exit 0
  fi
done
