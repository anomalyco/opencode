#!/usr/bin/env bash
# Builds the Android libraries and Kotlin bindings the Android app links, with the widget parts:
#
#   packages/widgets-rs/crates/widget-mobile/scripts/build-android.sh [out-dir]   (default: target/mobile/android)
#
# psychoscript-mobile's build-android.sh on this crate (see its header; ANDROID_NDK_HOME, cargo-ndk): <out>/jniLibs/
# {arm64-v8a,x86_64}/libwidget_mobile.so, the Kotlin bindings of psychoscript-mobile (com/anomalyco/psychoscript,
# with PsychoScriptGpu.kt and LiveFrames.kt) and of this crate (ai/opencode/widgets), and <out>/REVISION, the
# anomalyco/opencode commit it was built from.
set -euo pipefail
. "$(dirname "$0")/mobile.sh"
exec bash "$mobile/scripts/build-android.sh" "${1:-$root/target/mobile/android}"
