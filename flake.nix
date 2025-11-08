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
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      lib = nixpkgs.lib;
      forEachSystem = lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
      packageJson = builtins.fromJSON (builtins.readFile ./packages/opencode/package.json);
      bunTarget = {
        "aarch64-linux" = "bun-linux-arm64";
        "x86_64-linux" = "bun-linux-x64";
        "aarch64-darwin" = "bun-darwin-arm64";
        "x86_64-darwin" = "bun-darwin-x64";
      };
      scripts = ./nix/scripts;
      dummyHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      defaultNodeModules = builtins.listToAttrs (
        map (system: {
          name = system;
          value = dummyHash;
        }) systems
      );
      hashesFile = "${./nix}/hashes.json";
      hashesData =
        if builtins.pathExists hashesFile then builtins.fromJSON (builtins.readFile hashesFile) else { };
      hashes = {
        nodeModules = defaultNodeModules // (hashesData.nodeModules or { });
        optional = hashesData.optional or { };
        metadata = hashesData.metadata or { };
      };
      optionalPackagesFiles = {
        "aarch64-linux" = ./nix/optional-packages/aarch64-linux.txt;
        "x86_64-linux" = ./nix/optional-packages/x86_64-linux.txt;
        "aarch64-darwin" = ./nix/optional-packages/aarch64-darwin.txt;
        "x86_64-darwin" = ./nix/optional-packages/x86_64-darwin.txt;
      };
      modelsDev = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        pkgs."models-dev"
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
          mkNodeModules = pkgs.callPackage ./nix/node-modules.nix {
            hash = hashes.nodeModules.${system};
            optionalPackagesFile = optionalPackagesFiles.${system};
          };
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
            meta = {
                description = "Nix devshell shell for OpenCode";
                runtimeInputs = [ pkgs.bun ];
              };
            program = "${pkgs.writeShellApplication {
              name = "opencode-dev";
              text = ''
                exec bun run dev "$@"
              '';
            }}/bin/opencode-dev";
          };
        }
      );
    };
}
