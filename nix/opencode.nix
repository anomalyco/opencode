{
  lib,
  stdenvNoCC,
  bun,
  ripgrep,
  makeBinaryWrapper,
}:
args:
let
  inherit (args) scripts;
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
  inherit (args) version src;

  node_modules = mkModules {
    inherit (finalAttrs) version src;
  };

  nativeBuildInputs = [
    bun
    makeBinaryWrapper
  ];

  env.MODELS_DEV_API_JSON = args.modelsDev;
  env.OPENCODE_VERSION = args.version;
  env.OPENCODE_CHANNEL = "stable";
  dontConfigure = true;

  buildPhase = ''
    runHook preBuild

    cp -r ${finalAttrs.node_modules}/node_modules .
    cp -r ${finalAttrs.node_modules}/packages .

    (
      cd packages/opencode

      chmod -R u+w ./node_modules
      mkdir -p ./node_modules/@opencode-ai
      rm -f ./node_modules/@opencode-ai/{script,sdk,plugin}
      ln -s $(pwd)/../../packages/script ./node_modules/@opencode-ai/script
      ln -s $(pwd)/../../packages/sdk/js ./node_modules/@opencode-ai/sdk
      ln -s $(pwd)/../../packages/plugin ./node_modules/@opencode-ai/plugin

      cp ${./bundle.ts} ./bundle.ts
      chmod +x ./bundle.ts
      bun run ./bundle.ts
    )

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    cd packages/opencode
    if [ ! -d dist ]; then
      echo "ERROR: dist directory missing after bundle step"
      exit 1
    fi

    mkdir -p $out/lib/opencode
    cp -r dist $out/lib/opencode/
    chmod -R u+w $out/lib/opencode/dist

    # Select bundled worker assets deterministically (sorted find output)
    worker_file=$(find "$out/lib/opencode/dist" -type f \( -path '*/tui/worker.*' -o -name 'worker.*' \) | sort | head -n1)
    parser_worker_file=$(find "$out/lib/opencode/dist" -type f -name 'parser.worker.*' | sort | head -n1)
    if [ -z "$worker_file" ]; then
      echo "ERROR: bundled worker not found"
      exit 1
    fi

    main_wasm=$(printf '%s\n' "$out"/lib/opencode/dist/tree-sitter-*.wasm | sort | head -n1)
    wasm_list=$(find "$out/lib/opencode/dist" -maxdepth 1 -name 'tree-sitter-*.wasm' -print)
    for patch_file in "$worker_file" "$parser_worker_file"; do
      [ -z "$patch_file" ] && continue
      [ ! -f "$patch_file" ] && continue
      if [ -n "$wasm_list" ] && grep -q 'tree-sitter' "$patch_file"; then
        # Rewrite wasm references to absolute store paths to avoid runtime resolve failures.
        bun --bun ${scripts + "/patch-wasm.ts"} "$patch_file" "$main_wasm" $wasm_list
      fi
	    done

	    mkdir -p $out/lib/opencode/node_modules
	    cp -r ../../node_modules/.bun $out/lib/opencode/node_modules/
	    bun_root="$out/lib/opencode/node_modules/.bun"
	    chmod -R u+w "$bun_root"
	    bun_target="${args.target}"
	    bun_target="''${bun_target#bun-}"
	    bun_os="''${bun_target%-*}"
	    bun_arch="''${bun_target#*-}"

    # bun's `--cpu="*"` / `--os="*"` pulls in all platform optional deps; prune to this build's platform.
    rm -rf "$bun_root"/*-win32-*@* "$bun_root"/*-windows-*@* "$bun_root"/*-freebsd-*@*
    if [ "$bun_os" = "linux" ]; then
      rm -rf "$bun_root"/*-darwin-*@*
    fi
    if [ "$bun_os" = "darwin" ]; then
      rm -rf "$bun_root"/*-linux-*@*
    fi
    if [ "$bun_arch" = "arm64" ]; then
      rm -rf "$bun_root"/*-"$bun_os"-x64@* "$bun_root"/*-"$bun_os"-64@*
    fi
    if [ "$bun_arch" = "x64" ]; then
      rm -rf "$bun_root"/*-"$bun_os"-arm64@* "$bun_root"/*-"$bun_os"-aarch64@*
    fi
    mkdir -p $out/lib/opencode/node_modules/@opentui

    mkdir -p $out/bin
    makeWrapper ${bun}/bin/bun $out/bin/opencode \
      --add-flags "run" \
      --add-flags "$out/lib/opencode/dist/src/index.js" \
      --prefix PATH : ${lib.makeBinPath [ ripgrep ]} \
      --argv0 opencode

    runHook postInstall
  '';

  postInstall = ''
    for pkg in $out/lib/opencode/node_modules/.bun/@opentui+core-* $out/lib/opencode/node_modules/.bun/@opentui+solid-* $out/lib/opencode/node_modules/.bun/@opentui+core@* $out/lib/opencode/node_modules/.bun/@opentui+solid@*; do
      if [ -d "$pkg" ]; then
        pkgName=$(basename "$pkg" | sed 's/@opentui+\([^@]*\)@.*/\1/')
        ln -sf ../.bun/$(basename "$pkg")/node_modules/@opentui/$pkgName \
          $out/lib/opencode/node_modules/@opentui/$pkgName
      fi
    done
  '';

  dontFixup = true;

  meta = {
    description = "AI coding agent built for the terminal";
    longDescription = ''
      OpenCode is a terminal-based agent that can build anything.
      It combines a TypeScript/JavaScript core with a Go-based TUI
      to provide an interactive AI coding experience.
    '';
    homepage = "https://github.com/anomalyco/opencode";
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
