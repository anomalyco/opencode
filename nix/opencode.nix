{ lib, stdenv, stdenvNoCC, bun, fzf, ripgrep, makeBinaryWrapper }:
args:
let
  scripts = args.scripts;
  mkModules =
    attrs:
    args.mkNodeModules (
      attrs
      // {
        canonicalizeScript = scripts + "/canonicalize-node-modules.ts";
        normalizeBinsScript = scripts + "/normalize-bun-binaries.ts";
      }
    );
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencode";
  version = args.version;

  src = args.src;

  node_modules = mkModules {
    version = finalAttrs.version;
    src = finalAttrs.src;
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

  env.MODELS_DEV_API_JSON = args.modelsDev;
  env.OPENCODE_VERSION = args.version;
  env.OPENCODE_CHANNEL = "stable";

  buildPhase = ''
    runHook preBuild

    cp ${scripts + "/bun-build.ts"} bun-build.ts

    substituteInPlace bun-build.ts \
      --replace '@VERSION@' "${finalAttrs.version}"

    export BUN_COMPILE_TARGET=${args.target}
    bun --bun bun-build.ts

    runHook postBuild
  '';

  dontStrip = true;

  installPhase = ''
    runHook preInstall

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
    if [ -f opencode-assets.manifest ]; then
      while IFS= read -r asset; do
        [ -z "$asset" ] && continue
        if [ ! -f "$asset" ]; then
          echo "ERROR: referenced asset \"$asset\" missing"
          exit 1
        fi
        install -Dm644 "$asset" "$out/bin/$(basename "$asset")"
      done < opencode-assets.manifest
    fi
    runHook postInstall
  '';

  postFixup = ''
    wrapProgram "$out/bin/opencode" --prefix PATH : ${lib.makeBinPath [ fzf ripgrep ]}
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
      "aarch64-darwin"
      "x86_64-darwin"
    ];
    mainProgram = "opencode";
  };
})
