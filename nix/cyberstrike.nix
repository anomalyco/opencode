{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node-modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "cyberstrike";
  inherit (node_modules) version src;
  inherit node_modules;

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
  env.CYBERSTRIKE_DISABLE_MODELS_FETCH = true;
  env.CYBERSTRIKE_VERSION = finalAttrs.version;
  env.CYBERSTRIKE_CHANNEL = "local";

  buildPhase = ''
    runHook preBuild

    cd ./packages/cyberstrike
    bun --bun ./script/build.ts --single --skip-install
    bun --bun ./script/schema.ts schema.json

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/cyberstrike-*/bin/cyberstrike $out/bin/cyberstrike
    install -Dm644 schema.json $out/share/cyberstrike/schema.json

    wrapProgram $out/bin/cyberstrike \
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
    installShellCompletion --cmd cyberstrike \
      --bash <($out/bin/cyberstrike completion) \
      --zsh <(SHELL=/bin/zsh $out/bin/cyberstrike completion)
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "CYBERSTRIKE_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    jsonschema = "${placeholder "out"}/share/cyberstrike/schema.json";
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://cyberstrike.io/";
    license = lib.licenses.mit;
    mainProgram = "cyberstrike";
    inherit (node_modules.meta) platforms;
  };
})
