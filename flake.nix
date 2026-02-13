{
  description = "OpenCode development flake";

  nixConfig = {
    extra-substituters = [
      "https://weyl-ai.cachix.org"
      "https://nix-community.cachix.org"
    ];
    extra-trusted-public-keys = [
      "weyl-ai.cachix.org-1:cR0SpSAPw7wejZ21ep4SLojE77gp5F2os260eEWqTTw="
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    # TODO: Switch back to nix-community/bun2nix once PR #84 is merged
    # PR: https://github.com/nix-community/bun2nix/pull/84
    bun2nix = {
      url = "github:b7r6/bun2nix/fix-tarball-url-parsing";
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
        "x86_64-darwin"
      ];
      forEachSystem =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f {
            pkgs = nixpkgs.legacyPackages.${system};
            bun2nix' = bun2nix.packages.${system}.default;
          }
        );
      rev = self.shortRev or self.dirtyShortRev or "dirty";
    in
    {
      devShells = forEachSystem (
        { pkgs, bun2nix' }:
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              nodejs_20
              pkg-config
              openssl
              git
              bun2nix'
            ];
          };
        }
      );

      overlays = {
        default =
          final: _prev:
          let
            bun2nix' = bun2nix.packages.${final.system}.default;
            bunDeps = final.callPackage ./nix/bun-deps.nix {
              inherit bun2nix';
            };
            opencode = final.callPackage ./nix/opencode.nix {
              inherit bunDeps bun2nix';
            };
            desktop = final.callPackage ./nix/desktop.nix {
              inherit opencode;
            };
          in
          {
            inherit opencode;
            opencode-desktop = desktop;
          };
      };

      packages = forEachSystem (
        { pkgs, bun2nix' }:
        let
          bunDeps = pkgs.callPackage ./nix/bun-deps.nix {
            inherit bun2nix';
          };
          opencode = pkgs.callPackage ./nix/opencode.nix {
            inherit bunDeps bun2nix';
          };
          desktop = pkgs.callPackage ./nix/desktop.nix {
            inherit opencode;
          };
        in
        {
          default = opencode;
          inherit opencode desktop;
        }
      );
    };
}
