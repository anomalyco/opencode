{ inputs, ... }:
{
  imports = [ inputs.haskell-flake.flakeModule ];

  perSystem =
    { self', pkgs, ... }:
    {
      haskellProjects.default = {
        settings = {
          opencode-server.stan = true;
          librarySystemDepends = [ pkgs.zlib ];
        };
        devShell = {
          tools = hp: {
            cabal = hp.cabal-install;
          };
          mkShellArgs = {
            packages = [ pkgs.zlib ];
          };
        };
      };

      packages.default = self'.packages.opencode-server;
      checks.default = self'.packages.opencode-server;
    };
}
