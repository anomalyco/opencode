{
  lib,
  pkgs,
  stdenvNoCC,
  callPackage,
  bun,
  nodejs,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node-modules.nix { },
}:
stdenvNoCC.mkDerivation (
  finalAttrs:
  let
    # Grammar assets fetched content-addressed by Nix. build.ts falls back to the
    # network when OPENTUI_BUNDLED_GRAMMARS_DIR is absent.
    bundledGrammarAssets = builtins.fromJSON (
      builtins.readFile ../packages/opencode/script/bundled-grammars.json
    );

    # Group assets by language prefix so each grammar becomes its own
    # derivation.
    bundledGrammarGroups = lib.groupBy (
      asset: lib.head (lib.splitString "-" asset.file)
    ) bundledGrammarAssets;

    individualGrammars = lib.mapAttrs (
      lang: assets:
      pkgs.runCommand "opencode-assets-grammar-${lang}"
        {
          passthru = {
            grammar = lang;
            grammarAssets = assets;
          };
        }
        (
          "mkdir -p $out\n"
          + lib.concatMapStringsSep "\n" (
            asset:
            "cp ${
              pkgs.fetchurl {
                url = asset.url;
                sha256 = asset.sha256;
              }
            } $out/${asset.file}"
          ) assets
        )
    ) bundledGrammarGroups;

    grammarDerivations = lib.attrValues individualGrammars;

    treeSitterGrammars =
      pkgs.runCommand "opencode-tree-sitter-grammars"
        { passthru = { inherit bundledGrammarAssets individualGrammars; }; }
        (
          "mkdir -p $out\n"
          + lib.concatMapStringsSep "\n" (grammar: "cp -r ${grammar}/. $out/") grammarDerivations
        );

  in
  {
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
    ];

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

    env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
    env.OPENCODE_DISABLE_MODELS_FETCH = true;
    env.OPENTUI_BUNDLED_GRAMMARS_DIR = "${treeSitterGrammars}";
    env.OPENCODE_VERSION = finalAttrs.version;
    env.OPENCODE_CHANNEL = "prod";

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
            # bun runs sysctl to detect if running on rosetta2
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
    versionCheckKeepEnvironment = [
      "HOME"
      "OPENCODE_DISABLE_MODELS_FETCH"
    ];
    versionCheckProgramArg = "--version";

    passthru = {
      jsonschema = "${placeholder "out"}/share/opencode/schema.json";
      env = finalAttrs.env;
      inherit treeSitterGrammars;
    };

    meta = {
      description = "The open source coding agent";
      homepage = "https://opencode.ai";
      license = lib.licenses.mit;
      mainProgram = "opencode";
      inherit (node_modules.meta) platforms;
    };
  }
)
