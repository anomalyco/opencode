{
  description = "OpenCode Haskell Server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        haskellPackages = pkgs.haskellPackages.override {
          overrides = hself: hsuper: {
            opencode-server = hself.callCabal2nix "opencode-server" ./. { };
          };
        };

        opencode-server = haskellPackages.opencode-server;
      in
      {
        packages = {
          default = opencode-server;
          inherit opencode-server;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            haskellPackages.ghc
            haskellPackages.cabal-install
            haskellPackages.haskell-language-server
            zlib
          ];

          inputsFrom = [ opencode-server.env ];

          shellHook = ''
            echo "OpenCode Haskell Server development shell"
            echo "Run 'cabal build' to build"
            echo "Run 'cabal run' to start the server"
          '';
        };
      }
    );
}
