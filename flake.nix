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
      forEachSystem = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forEachSystem (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
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
          pkgs = import nixpkgs { inherit system; };
          bun-target = {
            "aarch64-linux" = "bun-linux-arm64";
            "x86_64-linux" = "bun-linux-x64";
          };

          models-dev = pkgs.stdenvNoCC.mkDerivation {
            pname = "models-dev";
            version = "unstable";

            src = pkgs.fetchurl {
              url = "https://models.dev/api.json";
              hash = "sha256-xQ1FjLTz8g4YbgZZ97j8FrYeuZd9aDUtLB67I23RQDQ=";
            };

            dontUnpack = true;
            dontBuild = true;

            installPhase = ''
              mkdir -p $out/dist
              cp $src $out/dist/_api.json
            '';
          };
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
              version = "1.0.23";

              src = ./.;

              node_modules = stdenvNoCC.mkDerivation {
                pname = "opencode-node_modules";
                inherit (finalAttrs) version src;

                impureEnvVars =
                  lib.fetchers.proxyImpureEnvVars
                  ++ [
                    "GIT_PROXY_COMMAND"
                    "SOCKS_SERVER"
                  ];

                nativeBuildInputs = [ bun ];

                dontConfigure = true;

                buildPhase = ''
                  runHook preBuild
                  export HOME=$(mktemp -d)
                  export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
                  bun install \
                    --frozen-lockfile \
                    --ignore-scripts \
                    --no-progress
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
                outputHash = "sha256-S77NbdzNuHALDapU3Qr/lGPwvHCvyGxr+nyVEO9zeBg=";
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

              env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";

              buildPhase = ''
                runHook preBuild

                cat > tsconfig.build.json <<'EOF'
                {
                  "compilerOptions": {
                    "jsx": "preserve",
                    "jsxImportSource": "@opentui/solid",
                    "allowImportingTsExtensions": true,
                    "baseUrl": ".",
                    "paths": {
                      "@/*": ["./packages/opencode/src/*"],
                      "@tui/*": ["./packages/opencode/src/cli/cmd/tui/*"]
                    }
                  }
                }
                EOF

                cat > bun-build.ts <<'EOF'
                import solidPlugin from "./packages/opencode/node_modules/@opentui/solid/scripts/solid-plugin"
                import path from "path"
                import fs from "fs"

                const version = "@VERSION@"
                const channel = "@CHANNEL@"
                const repoRoot = process.cwd()
                const packageDir = path.join(repoRoot, "packages/opencode")

                const parserWorker = fs.realpathSync(
                  path.join(packageDir, "./node_modules/@opentui/core/parser.worker.js"),
                )
                const dir = packageDir
                const workerPath = "./src/cli/cmd/tui/worker.ts"
                const target = process.env["BUN_COMPILE_TARGET"]

                if (!target) {
                  throw new Error("BUN_COMPILE_TARGET not set")
                }

                // Change to package directory like the original build script does
                process.chdir(packageDir)

                const result = await Bun.build({
                  conditions: ["browser"],
                  tsconfig: "./tsconfig.json",
                  plugins: [solidPlugin],
                  sourcemap: "external",
                  entrypoints: ["./src/index.ts", parserWorker, workerPath],
                  define: {
                    OPENCODE_VERSION: `'@VERSION@'`,
                    OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/" + path.relative(dir, parserWorker).replace(/\\/g, "/"),
                    OPENCODE_CHANNEL: `'@CHANNEL@'`,
                  },
                  compile: {
                    target,
                    outfile: "opencode",
                    execArgv: ["--user-agent=opencode/" + version, "--env-file=\"\"", "--"],
                    windows: {},
                  },
                })

                if (!result.success) {
                  console.error("Build failed!")
                  for (const log of result.logs) {
                    console.error(log)
                  }
                  throw new Error("Compilation failed")
                }

                // Nix packaging needs a real file for Worker() lookups, so emit a JS bundle alongside the binary.
                const workerBundle = await Bun.build({
                  entrypoints: [workerPath],
                  tsconfig: "./tsconfig.json",
                  plugins: [solidPlugin],
                  target: "bun",
                  outdir: "./.opencode-worker",
                  sourcemap: "none",
                })

                if (!workerBundle.success) {
                  console.error("Worker build failed!")
                  for (const log of workerBundle.logs) {
                    console.error(log)
                  }
                  throw new Error("Worker compilation failed")
                }

                const workerOutput = workerBundle.outputs.find((output) => output.kind === "entry-point")
                if (!workerOutput) {
                  throw new Error("Worker build produced no entry-point output")
                }

                const workerTarget = path.join(packageDir, "opencode-worker.js")
                const workerSource = workerOutput.path
                await Bun.write(workerTarget, Bun.file(workerSource))
                fs.rmSync(path.dirname(workerSource), { recursive: true, force: true })

                console.log("Build successful!")
                EOF

                substituteInPlace bun-build.ts \
                  --replace '@VERSION@' "${finalAttrs.version}" \
                  --replace '@CHANNEL@' "latest"

                export BUN_COMPILE_TARGET=${bun-target.${stdenvNoCC.hostPlatform.system}}
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
          pkgs = import nixpkgs { inherit system; };
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
