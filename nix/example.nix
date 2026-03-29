# Example NixOS configuration
{ config, pkgs, ... }:

{
  services.opencode-telegram = {
    enable = true;

    # Telegram bot token (use agenix/sops-nix)
    botTokenFile = "/run/secrets/telegram-bot-token";

    # Environment file for API keys (systemd EnvironmentFile)
    # Contents: ANTHROPIC_API_KEY=sk-ant-...
    environmentFile = "/run/secrets/opencode-env";

    # opencode.json as Nix attrs — full opencode configuration
    settings = {
      model = "anthropic/claude-sonnet-4-6";
      small_model = "anthropic/claude-haiku-4-5";

      provider = {
        anthropic = {
          # Key loaded from environmentFile as ANTHROPIC_API_KEY
        };
      };

      permission = {
        # Auto-approve everything in headless mode
        "*" = "auto";
      };

      mcp = {
        # Add MCP servers here if needed
      };

      agent = {
        build = {
          model = "anthropic/claude-sonnet-4-6";
        };
      };

      instructions = [
        "You are running as a Telegram bot. Format responses for chat."
        "Keep responses concise."
      ];
    };

    # Telegram access control
    accessConfig = {
      dmPolicy = "pairing";
      allowFrom = [
        "123456789"   # Add Telegram user IDs after pairing
      ];
      groups = {
        "-1009876543210" = {
          requireMention = true;
          allowFrom = [];
        };
      };
      pending = {};
      mentionPatterns = [ "@YourBotName" ];
    };
  };
}
