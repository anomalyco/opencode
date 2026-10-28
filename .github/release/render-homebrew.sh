#!/usr/bin/env bash
# render-homebrew.sh <sign-macos dir> <build-archives dir> <tap dir>: writes Formula opencode-v2.rb with the
# hashes of the signed macOS and the Linux archives.
. "$(dirname "$0")/lib.sh"

macos=$1 archives=$2 tap=$3
sum() { sha256 "$1" | cut -c1-64; }
base="https://opencode.ai/files/bin/$OPENCODE_VERSION"
cat > "$tap/opencode-v2.rb" <<FORMULA
# typed: false
# frozen_string_literal: true

class OpencodeV2 < Formula
  desc "OpenCode V2 - the AI coding agent for the terminal"
  homepage "https://github.com/anomalyco/opencode"
  version "$OPENCODE_VERSION"
  license "MIT"

  depends_on "ripgrep"
  conflicts_with "opencode", because: "both install an opencode binary"

  on_macos do
    if Hardware::CPU.arm?
      url "$base/opencode-darwin-arm64.zip"
      sha256 "$(sum "$macos/opencode-darwin-arm64.zip")"
    else
      url "$base/opencode-darwin-x64-baseline.zip"
      sha256 "$(sum "$macos/opencode-darwin-x64-baseline.zip")"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "$base/opencode-linux-arm64.tar.gz"
      sha256 "$(sum "$archives/opencode-linux-arm64.tar.gz")"
    else
      url "$base/opencode-linux-x64-baseline.tar.gz"
      sha256 "$(sum "$archives/opencode-linux-x64-baseline.tar.gz")"
    end
  end

  def install
    bin.install "opencode"
  end
end
FORMULA
cat "$tap/opencode-v2.rb"
