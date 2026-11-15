#!/bin/sh
# Compile-checks the workspace for Windows on Linux (script/check-target.sh): x64 by default, or arm64. First it runs
# script/lint-windows.sh, which finds code that is right on Unix and wrong on Windows.
#
# Usage: sh script/check-windows.sh [x64|arm64] [extra cargo clippy arguments...]
set -eu

target=x86_64-pc-windows-msvc
case ${1:-} in
    x64) shift ;;
    arm64)
        target=aarch64-pc-windows-msvc
        shift
        ;;
esac
sh "$(dirname -- "$0")/lint-windows.sh"
exec sh "$(dirname -- "$0")/check-target.sh" "$target" "$@"
