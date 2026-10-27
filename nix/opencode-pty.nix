{
  lib,
  stdenv,
  bun,
  autoPatchelfHook,
  node_modules,
}:
stdenv.mkDerivation {
  pname = "opencode-pty";
  version = (lib.importJSON ../packages/core/package.json).dependencies."@opencode-ai/pty";

  nativeBuildInputs = [
    bun
    autoPatchelfHook
  ];
  buildInputs = [ stdenv.cc.libc ];
  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 "$(bun --print 'require("${node_modules}/packages/core/node_modules/@opencode-ai/pty").binaryPath')" \
      "$out/bin/opencode-pty"
    runHook postInstall
  '';

  meta = {
    mainProgram = "opencode-pty";
    platforms = lib.intersectLists lib.platforms.linux node_modules.meta.platforms;
  };
}
