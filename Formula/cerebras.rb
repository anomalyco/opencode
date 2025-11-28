# Homebrew Formula for Cerebras Code
#
# To install:
#   brew tap arihantchoudhary/cerebras
#   brew install cerebras
#
# Or install directly from this file:
#   brew install Formula/cerebras.rb

class Cerebras < Formula
  desc "AI-powered coding assistant CLI"
  homepage "https://github.com/arihantchoudhary/opencode"
  version "1.0.115"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/arihantchoudhary/opencode/releases/download/v#{version}/cerebras-darwin-arm64.zip"
      sha256 "REPLACE_WITH_ACTUAL_SHA256_ARM64"
    else
      url "https://github.com/arihantchoudhary/opencode/releases/download/v#{version}/cerebras-darwin-x64.zip"
      sha256 "REPLACE_WITH_ACTUAL_SHA256_X64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/arihantchoudhary/opencode/releases/download/v#{version}/cerebras-linux-arm64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256_LINUX_ARM64"
    else
      url "https://github.com/arihantchoudhary/opencode/releases/download/v#{version}/cerebras-linux-x64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA256_LINUX_X64"
    end
  end

  def install
    bin.install "cerebras"
  end

  def post_install
    # Print authentication message
    ohai "Cerebras Code installed successfully!"
    puts ""
    puts "To get started:"
    puts "  1. Run: cerebras"
    puts "  2. You'll be prompted to login on first use"
    puts ""
    puts "For more information, visit:"
    puts "  https://github.com/arihantchoudhary/opencode"
    puts ""
  end

  test do
    # Test that the binary exists and is executable
    assert_match "cerebras", shell_output("#{bin}/cerebras --version")
  end

  # Caveats shown after installation
  def caveats
    <<~EOS
      ╔═══════════════════════════════════════════════════╗
      ║                                                   ║
      ║   Welcome to Cerebras Code!                       ║
      ║                                                   ║
      ║   To start coding with AI:                        ║
      ║                                                   ║
      ║     $ cerebras                                    ║
      ║                                                   ║
      ║   You'll be prompted to login on first use.       ║
      ║                                                   ║
      ║   Need help?                                      ║
      ║     $ cerebras --help                             ║
      ║                                                   ║
      ║   Documentation:                                  ║
      ║     https://github.com/arihantchoudhary/opencode  ║
      ║                                                   ║
      ╚═══════════════════════════════════════════════════╝
    EOS
  end
end
