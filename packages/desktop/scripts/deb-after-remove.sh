#!/bin/sh
set -e

LINK="/usr/bin/opencode-cli"

if [ -L "${LINK}" ] && [ ! -e "${LINK}" ]; then
  rm -f "${LINK}"
fi
