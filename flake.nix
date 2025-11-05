{
  description = "OpenCode development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    {
      nixpkgs,
      ...
    }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      lib = nixpkgs.lib;
      forEachSystem = lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
      packageJson = builtins.fromJSON (builtins.readFile ./packages/opencode/package.json);
      bunTarget = {
        "aarch64-linux" = "bun-linux-arm64";
        "x86_64-linux" = "bun-linux-x64";
      };
      scripts = ./nix/scripts;
      modelsDev = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        pkgs.callPackage ./nix/models-dev.nix { }
      );
    in
    {
      devShells = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              nodejs_20
              pkg-config
              openssl
              git
            ];
          };
        }
      );

      packages = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
          mkNodeModules = pkgs.callPackage ./nix/node-modules.nix { };
          mkPackage = pkgs.callPackage ./nix/opencode.nix { };
        in
        {
          default = mkPackage {
            version = packageJson.version;
            src = ./.;
            scripts = scripts;
            target = bunTarget.${system};
            modelsDev = "${modelsDev.${system}}/dist/_api.json";
            mkNodeModules = mkNodeModules;
          };
        }
      );

      apps = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          opencode-dev = {
            type = "app";
            program = pkgs.writeShellApplication {
              name = "opencode-dev";
              runtimeInputs = [ pkgs.bun ];
              text = ''
                exec bun run dev "$@"
              '';
            };
          };
        }
      );
    };
}
