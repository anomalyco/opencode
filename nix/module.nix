{ config, lib, pkgs, ... }:

let
  cfg = config.services.opencode-telegram;

  defaultPackage = pkgs.opencode.overrideAttrs (old: {
    src = pkgs.fetchFromGitHub {
      owner = "Avimitin";
      repo = "opencode";
      rev = "feature/telegram-channel";
      hash = lib.fakeHash;
    };
  });
in
{
  options.services.opencode-telegram = {
    enable = lib.mkEnableOption "OpenCode Telegram bot";

    package = lib.mkOption {
      type = lib.types.package;
      default = defaultPackage;
      defaultText = lib.literalExpression ''
        pkgs.opencode.overrideAttrs (old: {
          src = pkgs.fetchFromGitHub {
            owner = "Avimitin";
            repo = "opencode";
            rev = "feature/telegram-channel";
            hash = "...";
          };
        })
      '';
      description = "The opencode package to use. Defaults to nixpkgs opencode with Avimitin/opencode source.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "opencode-telegram";
      description = "User to run the service as.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "opencode-telegram";
      description = "Group to run the service as.";
    };

    stateDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/opencode-telegram";
      description = "State directory for opencode and Telegram channel data.";
    };

    botTokenFile = lib.mkOption {
      type = lib.types.path;
      description = ''
        Path to a file containing the Telegram bot token.
        The file should contain just the token string.
        Use agenix or sops-nix to manage this secret.
      '';
    };

    anthropicKeyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to a file containing the Anthropic API key.
        The file should contain just the key string.
      '';
    };

    provider = lib.mkOption {
      type = lib.types.str;
      default = "anthropic";
      description = "LLM provider to use (anthropic, openai, etc).";
    };

    model = lib.mkOption {
      type = lib.types.str;
      default = "claude-sonnet-4-6";
      description = "Model ID to use.";
    };

    accessConfig = lib.mkOption {
      type = lib.types.attrs;
      default = {
        dmPolicy = "pairing";
        allowFrom = [];
        groups = {};
        pending = {};
        mentionPatterns = [];
      };
      description = "Telegram channel access.json configuration.";
    };

    extraEnvironment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      description = "Extra environment variables for the service.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.${cfg.user} = {
      isSystemUser = true;
      home = cfg.stateDir;
      createHome = true;
      group = cfg.group;
    };
    users.groups.${cfg.group} = {};

    systemd.tmpfiles.rules = [
      "d ${cfg.stateDir} 0700 ${cfg.user} ${cfg.group} -"
      "d ${cfg.stateDir}/.opencode 0700 ${cfg.user} ${cfg.group} -"
      "d ${cfg.stateDir}/.opencode/channels 0700 ${cfg.user} ${cfg.group} -"
      "d ${cfg.stateDir}/.opencode/channels/telegram 0700 ${cfg.user} ${cfg.group} -"
      "d ${cfg.stateDir}/.opencode/channels/telegram/approved 0700 ${cfg.user} ${cfg.group} -"
    ];

    systemd.services.opencode-telegram = {
      description = "OpenCode Telegram Bot";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        WorkingDirectory = cfg.stateDir;
        Restart = "on-failure";
        RestartSec = 10;

        # Hardening
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = "yes";
        PrivateTmp = true;
        ReadWritePaths = [ cfg.stateDir ];
      };

      preStart = ''
        # Write access.json
        cat > ${cfg.stateDir}/.opencode/channels/telegram/access.json <<'ACCESSEOF'
        ${builtins.toJSON cfg.accessConfig}
        ACCESSEOF

        # Write .env with bot token
        echo "TELEGRAM_BOT_TOKEN=$(cat ${cfg.botTokenFile})" > ${cfg.stateDir}/.opencode/channels/telegram/.env
        chmod 600 ${cfg.stateDir}/.opencode/channels/telegram/.env
      '';

      environment = {
        HOME = cfg.stateDir;
        TELEGRAM_STATE_DIR = "${cfg.stateDir}/.opencode/channels/telegram";
      } // cfg.extraEnvironment;

      script = ''
        # Load API key if provided
        ${lib.optionalString (cfg.anthropicKeyFile != null) ''
          export ANTHROPIC_API_KEY="$(cat ${cfg.anthropicKeyFile})"
        ''}

        exec ${cfg.package}/bin/bun run ${cfg.package}/lib/opencode-telegram/src/index.ts
      '';
    };
  };
}
