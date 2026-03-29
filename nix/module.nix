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

  # Generate opencode.json from Nix attrs
  opencodeConfigFile = pkgs.writeText "opencode.json" (builtins.toJSON cfg.settings);
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
      description = "The opencode package to use.";
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
        Use agenix or sops-nix to manage this secret.
      '';
    };

    settings = lib.mkOption {
      type = lib.types.attrs;
      default = {};
      description = ''
        OpenCode configuration as a Nix attribute set.
        This will be serialized to opencode.json.
        See https://opencode.ai/docs/configuration for all options.

        Example:
          settings = {
            model = "anthropic/claude-sonnet-4-6";
            provider = {
              anthropic = {
                api_key_env = "ANTHROPIC_API_KEY";
              };
            };
            mcp = { };
            permission = {
              "*" = "auto";
            };
          };
      '';
      example = lib.literalExpression ''
        {
          model = "anthropic/claude-sonnet-4-6";
          provider = {
            anthropic = {
              api_key_env = "ANTHROPIC_API_KEY";
            };
          };
          permission = { "*" = "auto"; };
        }
      '';
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

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Path to an environment file (EnvironmentFile= in systemd).
        Use this for secrets like ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
        Format: KEY=VALUE per line.
      '';
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
      } // lib.optionalAttrs (cfg.environmentFile != null) {
        EnvironmentFile = cfg.environmentFile;
      };

      preStart = ''
        # Write opencode.json
        cp ${opencodeConfigFile} ${cfg.stateDir}/opencode.json

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
        exec ${cfg.package}/bin/bun run ${cfg.package}/lib/opencode-telegram/src/index.ts
      '';
    };
  };
}
