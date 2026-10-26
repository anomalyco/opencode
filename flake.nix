{
  description = "OpenCode development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    bun2nix = {
      url = "github:nix-community/bun2nix/0f2a1f0b6f42cebe3b149bf62d38754c5e0e9729";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      bun2nix,
      ...
    }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      rev = self.shortRev or self.dirtyShortRev or "dirty";
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs
            pkg-config
            openssl
            git
          ];
        };
      });

      checks = forEachSystem (
        pkgs:
        let
          opencode = self.packages.${pkgs.stdenv.hostPlatform.system}.opencode;
        in
        {
          runtime =
            pkgs.runCommand "opencode-runtime-checks"
              {
                nativeBuildInputs = [ pkgs.bun ];
                OPENCODE_NIX_CLI = pkgs.lib.getExe opencode;
                OPENCODE_NIX_VERSION = opencode.version;
                OPENCODE_DISABLE_MODELS_FETCH = "1";
              }
              ''
                export HOME=$(mktemp -d)
                export XDG_CONFIG_HOME="$HOME/config" XDG_DATA_HOME="$HOME/data"
                export XDG_STATE_HOME="$HOME/state" XDG_CACHE_HOME="$HOME/cache"
                cp -R ${opencode.src}/. .
                chmod -R u+w .
                cp -R ${opencode.node_modules}/. .
                mkdir -p nix
                cp ${./nix/check-tui-colors.ts} nix/check-tui-colors.ts
                cp ${./nix/check-service.ts} nix/check-service.ts
                bun nix/check-tui-colors.ts
                bun nix/check-service.ts
                touch $out
              '';
        }
      );

      overlays = {
        default =
          final: _prev:
          let
            node_modules = final.callPackage ./nix/node_modules.nix {
              inherit rev;
              bun2nix = bun2nix.packages.${final.stdenv.hostPlatform.system}.bun2nix;
            };
          in
          rec {
            opencode = final.callPackage ./nix/opencode.nix {
              inherit node_modules;
            };
            opencode-desktop = final.callPackage ./nix/desktop.nix {
              inherit opencode;
            };
          };
      };

      packages = forEachSystem (
        pkgs:
        let
          node_modules = pkgs.callPackage ./nix/node_modules.nix {
            inherit rev;
            bun2nix = bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.bun2nix;
          };
        in
        rec {
          default = opencode;
          opencode = pkgs.callPackage ./nix/opencode.nix {
            inherit node_modules;
          };
          opencode-desktop = pkgs.callPackage ./nix/desktop.nix {
            inherit opencode;
          };
        }
      );
    };
}
