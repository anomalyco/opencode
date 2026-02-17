{ inputs, ... }:
{
  imports = [ inputs.treefmt-nix.flakeModule ];

  perSystem.treefmt = {
    projectRootFile = "flake.nix";

    programs = {
      deadnix.enable = true;
      nixfmt.enable = true;
      nixf-diagnose.enable = true;
      statix.enable = true;

      mdformat.enable = true;

      shellcheck.enable = true;
      shfmt.enable = true;

      fourmolu.enable = true;
      hlint.enable = true;
      cabal-fmt.enable = true;
    };
  };
}
