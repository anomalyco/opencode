{
  lib,
  stdenv,
  stdenvNoCC,
  callPackage,
  bun,
  nodejs,
  patchelf,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  wayland,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node_modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencode";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    nodejs # for patchShebangs node_modules
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ] ++ lib.optionals stdenvNoCC.hostPlatform.isLinux [ patchelf ];

  postPatch = ''
    # NOTE: Relax Bun version check to be a warning instead of an error
    substituteInPlace packages/script/src/index.ts \
      --replace-fail 'throw new Error(`This script requires bun@''${expectedBunVersionRange}' \
                     'console.warn(`Warning: This script requires bun@''${expectedBunVersionRange}'
  '';

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules

    runHook postConfigure
  '';

  # bun dlopens this addon, which links libstdc++ with no RUNPATH, so on NixOS the
  # load fails and every directory watch dies (#53210).
  # Patch it here, before buildPhase embeds it into the standalone binary, rather
  # than exporting LD_LIBRARY_PATH: every spawned process inherits that, and it
  # outranks the program's own RUNPATH.
  postConfigure = lib.optionalString stdenvNoCC.hostPlatform.isLinux /* sh */ ''
    shopt -s nullglob
    watcher_paths=(
      node_modules/.bun/@parcel+watcher-linux-*-glibc@*/node_modules/@parcel/watcher-linux-*-glibc/watcher.node
    )
    shopt -u nullglob

    echo "postConfigure: Patching ''${#watcher_paths[@]} @parcel/watcher addon(s)" >&2
    patched_watchers=0
    for watcher_path in "''${watcher_paths[@]}"; do
      chmod u+w "$watcher_path"
      patchelf --add-rpath ${lib.makeLibraryPath [ (lib.getLib stdenv.cc.cc) ]} "$watcher_path"
      # Check the patch worked so the lib can be loaded successfully
      bun -e 'require(process.argv[1])' "$PWD/$watcher_path"
      (( patched_watchers += 1 ))
    done

    if (( patched_watchers != 0 )); then
      echo "postConfigure: Patched $patched_watchers native FS watcher(s)" >&2
    else
      # Fail the build if nothing was patched rather than ship an un-bootable watcher.
      echo "postConfigure: no @parcel/watcher glibc addon to patch under node_modules/.bun" >&2
      exit 1
    fi
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.OPENCODE_DISABLE_MODELS_FETCH = true;
  env.OPENCODE_VERSION = finalAttrs.version;
  env.OPENCODE_CHANNEL = "prod";
  env.NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    cd ./packages/cli
    bun --bun ./script/build.ts --single --skip-install

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/cli-*/bin/opencode $out/bin/opencode

    # OpenTUI dlopens Wayland for clipboard images.
    wrapProgram $out/bin/opencode \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if running on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      } ${lib.optionalString stdenvNoCC.hostPlatform.isLinux ''
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ wayland ]}
      ''}

    ln -s opencode $out/bin/opencode2

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # v2 dropped the `completion` subcommand; --completions is the global flag.
    # --completions also accepts sh, which emits the same script as bash.
    # staged to files, substitute below rejects anything that is not a regular file
    $out/bin/opencode --completions bash > opencode.bash
    $out/bin/opencode --completions zsh > _opencode
    $out/bin/opencode --completions fish > opencode.fish

    installShellCompletion --cmd opencode \
      --bash opencode.bash \
      --fish opencode.fish \
      --zsh _opencode

    # OPENCODE_CLI_NAME is a build-time define, so the opencode2 copies are
    # renamed rather than regenerated. --replace-fail is a global literal
    # substitution, so any lowercase opencode that later appears in a
    # description or help text ships as opencode2 in the opencode2 copy.
    substitute opencode.bash opencode2.bash --replace-fail opencode opencode2
    substitute _opencode _opencode2 --replace-fail opencode opencode2
    substitute opencode.fish opencode2.fish --replace-fail opencode opencode2

    installShellCompletion --cmd opencode2 \
      --bash opencode2.bash \
      --fish opencode2.fish \
      --zsh _opencode2
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "OPENCODE_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    env = finalAttrs.env;
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://opencode.ai";
    license = lib.licenses.mit;
    mainProgram = "opencode";
    inherit (node_modules.meta) platforms;
  };
})
