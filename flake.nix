{
  description = "opencode test setup";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs, ... }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
  in {
    packages.${system}.default = pkgs.stdenv.mkDerivation {
      pname = "opencode";
      version = "dev";
      src = ./.;
      nativeBuildInputs = [ pkgs.bun pkgs.nodejs_20 pkgs.go ];

      buildPhase = ''
        echo "bun install failes :("
      '';

      installPhase = ''
        # mkdir -p $out/bin
        # cat > $out/bin/opencode <<EOF
        # #!${pkgs.bash}/bin/bash
        # cd ${builtins.toString ./.}
        # exec ${pkgs.bun}/bin/bun run packages/opencode/src/index.ts "\$@"
        # EOF
        # chmod +x $out/bin/opencode
      '';

      meta = {
        description = "opencode: Bun-based AI CLI";
        mainProgram = "opencode";
      };
    };
  };
}
