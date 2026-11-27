#!/usr/bin/env bash
# Builds the PsychoScript Swift package the iOS app links, with the widget parts (macOS with Xcode):
#
#   packages/widgets-rs/crates/widget-mobile/scripts/build-ios.sh [out-dir]   (default: target/mobile/ios)
#
# psychoscript-mobile's build-ios.sh on this crate (see its header): <out>/PsychoScript/, a local Swift package
# (`import PsychoScript`: psychoscript-mobile's API and this crate's, one `PsychoScriptFFI.xcframework` of static
# libraries for iOS, the Simulator and macOS), and <out>/REVISION, the anomalyco/opencode commit it was built from.
set -euo pipefail
. "$(dirname "$0")/mobile.sh"
exec bash "$mobile/scripts/build-ios.sh" "${1:-$root/target/mobile/ios}"
