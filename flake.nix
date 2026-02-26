{
  description = "OpenCode development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      rev = self.shortRev or self.dirtyShortRev or "dirty";
      # TODO: remove once nixpkgs-unstable has bun >= 1.3.10
      bunOverlay = final: prev: {
        bun = prev.bun.overrideAttrs (old: rec {
          version = "1.3.10";
          passthru = old.passthru // {
            sources = {
              "aarch64-darwin" = final.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-darwin-aarch64.zip";
                hash = "sha256-ggNOh8nZtDmOphmu4u7V0qaMgVfppq4tEFLYTVM8zY0=";
              };
              "aarch64-linux" = final.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-aarch64.zip";
                hash = "sha256-+l7LJcr6jo9ch6D4M3GdRt0K8KhseDfYBlMSEtVWNtM=";
              };
              "x86_64-darwin" = final.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-darwin-x64-baseline.zip";
                hash = "sha256-+WhsTk52DbTN53oPH60F5VJki5ycv6T3/Jp+wmufMmc=";
              };
              "x86_64-linux" = final.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-x64.zip";
                hash = "sha256-9XvAGH45Yj3nFro6OJ/aVIay175xMamAulTce3M9Lgg=";
              };
            };
          };
          src =
            passthru.sources.${final.stdenvNoCC.hostPlatform.system}
              or (throw "Unsupported system: ${final.stdenvNoCC.hostPlatform.system}");
        });
      };
      forEachSystem =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              overlays = [ bunOverlay ];
            }
          )
        );
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs_20
            pkg-config
            openssl
            git
          ];
        };
      });

      overlays = {
        default =
          final: _prev:
          let
            pkgs = import nixpkgs {
              inherit (final) system;
              overlays = [ bunOverlay ];
            };
            node_modules = pkgs.callPackage ./nix/node_modules.nix {
              inherit rev;
            };
            opencode = pkgs.callPackage ./nix/opencode.nix {
              inherit node_modules;
            };
            desktop = pkgs.callPackage ./nix/desktop.nix {
              inherit opencode;
            };
          in
          {
            inherit opencode;
            opencode-desktop = desktop;
          };
      };

      packages = forEachSystem (
        pkgs:
        let
          node_modules = pkgs.callPackage ./nix/node_modules.nix {
            inherit rev;
          };
          opencode = pkgs.callPackage ./nix/opencode.nix {
            inherit node_modules;
          };
          desktop = pkgs.callPackage ./nix/desktop.nix {
            inherit opencode;
          };
        in
        {
          default = opencode;
          inherit opencode desktop;
          # Updater derivation with fakeHash - build fails and reveals correct hash
          node_modules_updater = node_modules.override {
            hash = pkgs.lib.fakeHash;
          };
        }
      );
    };
}
