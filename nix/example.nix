# Example NixOS configuration
# Add to your flake inputs:
#   opencode-telegram.url = "github:Avimitin/opencode/feature/telegram-channel";
# Then import the module:
#   imports = [ opencode-telegram.nixosModules.telegram ];

{ config, pkgs, ... }:

{
  services.opencode-telegram = {
    enable = true;

    # Use agenix or sops-nix for secrets
    botTokenFile = "/run/secrets/telegram-bot-token";
    anthropicKeyFile = "/run/secrets/anthropic-api-key";

    model = "claude-sonnet-4-6";

    accessConfig = {
      dmPolicy = "pairing";
      allowFrom = [
        # Add Telegram user IDs here after pairing
      ];
      groups = {
        # "-1001793556912" = {
        #   requireMention = true;
        #   allowFrom = [];
        # };
      };
      pending = {};
      mentionPatterns = [ "@YourBotName" ];
    };
  };
}
