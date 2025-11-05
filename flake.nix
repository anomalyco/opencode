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
      modelsDev = forEachSystem (
        system:
        let
          pkgs = pkgsFor system;
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "models-dev";
          version = "unstable";

          src = pkgs.fetchurl {
            url = "https://models.dev/api.json";
            hash = "sha256-Dff3OWJ7pD7LfVbZZ0Gf/QA65uw4ft14mdfBun0qDBg=";
          };

          dontUnpack = true;
          dontBuild = true;

          installPhase = ''
            mkdir -p $out/dist
            cp $src $out/dist/_api.json
          '';
        }
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
        in
        {
          default = pkgs.callPackage (
            {
              lib,
              stdenv,
              stdenvNoCC,
              bun,
              makeBinaryWrapper,
            }:
            stdenvNoCC.mkDerivation (finalAttrs: {
              pname = "opencode";
              version = packageJson.version;

              src = ./.;

              node_modules =
                let
                  canonicalizeScript = ./script/nix/canonicalize-node-modules.ts;
                  optionalMetadataScript = ./script/nix/optional-metadata.ts;
                  verifyShaScript = ./script/nix/verify-sha.ts;
                in
                stdenvNoCC.mkDerivation {
                pname = "opencode-node_modules";
                inherit (finalAttrs) version src;

                impureEnvVars =
                  lib.fetchers.proxyImpureEnvVars
                  ++ [
                    "GIT_PROXY_COMMAND"
                    "SOCKS_SERVER"
                  ];

                nativeBuildInputs = [ bun pkgs.cacert pkgs.curl ];

                dontConfigure = true;

                buildPhase = ''
                  runHook preBuild
                  export HOME=$(mktemp -d)
                  export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
                  bun install \
                    --frozen-lockfile \
                    --ignore-scripts \
                    --no-progress

                  cat > optional-packages.txt <<'EOF'
@parcel/watcher-linux-arm64-glibc
@opentui/core-linux-arm64
EOF

                  bun --bun ${optionalMetadataScript} optional-packages.txt > optional-metadata.txt

                  while IFS=$'\t' read -r name version sha; do
                    [ -z "$name" ] && continue
                    scope="''${name%%/*}"
                    remainder="''${name#*/}"
                    if [ "$scope" = "$name" ]; then
                      scope=""
                      remainder="$name"
                    fi

                    base="''${remainder##*/}"
                    encoded_scope="''${scope//@/%40}"

                    url="https://registry.npmjs.org/''${remainder}/-/''${base}-''${version}.tgz"
                    dest="node_modules/''${remainder}"
                    if [ -n "$scope" ]; then
                      url="https://registry.npmjs.org/''${encoded_scope}/''${remainder}/-/''${base}-''${version}.tgz"
                      dest="node_modules/''${scope}/''${remainder}"
                    fi

                    tmp=$(mktemp)
                    curl --fail --location --silent --show-error --tlsv1.2 "$url" -o "$tmp"
                    bun --bun ${verifyShaScript} "$tmp" "$sha"

                    mkdir -p "$dest"
                    tar -xzf "$tmp" -C "$dest" --strip-components=1 package
                    rm -f "$tmp"
                  done < optional-metadata.txt

                  rm -f optional-packages.txt optional-metadata.txt

                  bun --bun ${canonicalizeScript}

                  runHook postBuild
                '';

                installPhase = ''
                  runHook preInstall
                  mkdir -p $out
                  while IFS= read -r dir; do
                    rel="''${dir#./}"
                    dest="$out/$rel"
                    mkdir -p "$(dirname "$dest")"
                    cp -R "$dir" "$dest"
                  done < <(find . -type d -name node_modules -prune)
                  runHook postInstall
                '';

                dontFixup = true;

                outputHashAlgo = "sha256";
                outputHashMode = "recursive";
                outputHash = "sha256-s/UTz8BTYDOZpF9P6nZr0b7fNOS7Nv7hUfpihJgsSqE=";
              };

              nativeBuildInputs = [
                bun
                makeBinaryWrapper
              ];

              configurePhase = ''
                runHook preConfigure
                cp -R ${finalAttrs.node_modules}/. .
                runHook postConfigure
              '';

              env.MODELS_DEV_API_JSON = "${modelsDev.${system}}/dist/_api.json";

              buildPhase = ''
                runHook preBuild

                cp ${./script/nix/bun-build.ts} bun-build.ts

                substituteInPlace bun-build.ts \
                  --replace '@VERSION@' "${finalAttrs.version}"

                export BUN_COMPILE_TARGET=${bunTarget.${stdenvNoCC.hostPlatform.system}}
                bun --bun bun-build.ts

                runHook postBuild
              '';

              dontStrip = true;

              installPhase = ''
                runHook preInstall

                # The binary is created in the package directory after chdir
                cd packages/opencode
                if [ ! -f opencode ]; then
                  echo "ERROR: opencode binary not found in $(pwd)"
                  ls -la
                  exit 1
                fi
                if [ ! -f opencode-worker.js ]; then
                  echo "ERROR: opencode worker bundle not found in $(pwd)"
                  ls -la
                  exit 1
                fi

                install -Dm755 opencode $out/bin/opencode
                install -Dm644 opencode-worker.js $out/bin/opencode-worker.js
                runHook postInstall
              '';

              postFixup = lib.optionalString stdenvNoCC.hostPlatform.isLinux ''
                wrapProgram $out/bin/opencode \
                  --set LD_LIBRARY_PATH "${lib.makeLibraryPath [ stdenv.cc.cc.lib ]}"
              '';

              meta = {
                description = "AI coding agent built for the terminal";
                longDescription = ''
                  OpenCode is a terminal-based agent that can build anything.
                  It combines a TypeScript/JavaScript core with a Go-based TUI
                  to provide an interactive AI coding experience.
                '';
                homepage = "https://github.com/sst/opencode";
                license = lib.licenses.mit;
                platforms = [
                  "aarch64-linux"
                  "x86_64-linux"
                ];
                mainProgram = "opencode";
              };
            })
          ) { };
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
