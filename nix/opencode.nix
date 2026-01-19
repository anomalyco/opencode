{
  lib,
  stdenvNoCC,
  bun,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  rev ? "dirty",
}:
let
  packageJson = lib.pipe ../packages/opencode/package.json [
    builtins.readFile
    builtins.fromJSON
  ];
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencode";
  version = "${packageJson.version}-${rev}";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.intersection (lib.fileset.fromSource (lib.sources.cleanSource ../.)) (
      lib.fileset.unions [
        ../packages
        ../bun.lock
        ../package.json
        ../patches
        ../install
      ]
    );
  };

  node_modules = stdenvNoCC.mkDerivation {
    pname = "${finalAttrs.pname}-node_modules";
    inherit (finalAttrs) version src;

    impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ [
      "GIT_PROXY_COMMAND"
      "SOCKS_SERVER"
    ];

    nativeBuildInputs = [
      bun
    ];

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild
      export HOME=$(mktemp -d)
      export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
      bun install \
        --cpu="${if stdenvNoCC.hostPlatform.isAarch64 then "arm64" else "x64"}" \
        --os="${if stdenvNoCC.hostPlatform.isLinux then "linux" else "darwin"}" \
        --frozen-lockfile \
        --ignore-scripts \
        --no-progress \
        --linker=isolated
      bun --bun ${./scripts/canonicalize-node-modules.ts}
      bun --bun ${./scripts/normalize-bun-binaries.ts}
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out
      find . -type d -name node_modules -exec cp -R --parents {} $out \;

      runHook postInstall
    '';

    dontFixup = true;

    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash =
      (lib.pipe ./hashes.json [
        builtins.readFile
        builtins.fromJSON
      ]).nodeModules.${stdenvNoCC.hostPlatform.system};
  };

  nativeBuildInputs = [
    bun
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.OPENCODE_VERSION = finalAttrs.version;
  env.OPENCODE_CHANNEL = "local";

  buildPhase = ''
    runHook preBuild

    cd ./packages/opencode
    bun --bun ./script/build.ts --single --skip-install
    bun --bun ./script/schema.ts schema.json

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/opencode-*/bin/opencode $out/bin/opencode
    install -Dm644 schema.json $out/share/opencode/schema.json

    wrapProgram $out/bin/opencode \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if dunning on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      }

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # trick yargs into also generating zsh completions
    installShellCompletion --cmd opencode \
      --bash <($out/bin/opencode completion) \
      --zsh <(SHELL=/bin/zsh $out/bin/opencode completion)
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" ];
  versionCheckProgramArg = "--version";

  passthru = {
    jsonschema = "${placeholder "out"}/share/opencode/schema.json";
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://opencode.ai/";
    license = lib.licenses.mit;
    mainProgram = "opencode";
    platforms = [
      "aarch64-linux"
      "x86_64-linux"
      "aarch64-darwin"
      "x86_64-darwin"
    ];
  };
})
