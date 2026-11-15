{
  lib,
  stdenvNoCC,
  bun,
  node_modules,
}:
stdenvNoCC.mkDerivation {
  pname = "opencode-dependency-identity";
  version = "1";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.intersection (lib.fileset.fromSource (lib.sources.cleanSource ../.)) (
      lib.fileset.unions [
        ../packages
        ../nix/scripts
        ../bun.lock
        ../bunfig.toml
        ../package.json
      ]
    );
  };

  nativeBuildInputs = [ bun ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    export HOME=$(mktemp -d)
    export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
    # The test checks module identity, so it has to run against the install the
    # derivation produces rather than a fresh install of its own.
    cp -R ${node_modules}/. .
    cd nix/scripts
    bun test
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    runHook postInstall
  '';

  dontFixup = true;

  meta.platforms = [
    "aarch64-linux"
    "x86_64-linux"
    "aarch64-darwin"
  ];
}
