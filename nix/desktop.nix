{
  lib,
  stdenv,
  bun,
  nodejs,
  electron_41,
  makeWrapper,
  writableTmpDirAsHomeHook,
  autoPatchelfHook,
  opencode,
}:
let
  electron = electron_41;
in
stdenv.mkDerivation (finalAttrs: {
  pname = "opencode-desktop";
  inherit (opencode) version src node_modules;

  nativeBuildInputs = [
    bun
    nodejs
    makeWrapper
    writableTmpDirAsHomeHook
  ] ++ lib.optionals stdenv.hostPlatform.isLinux [
    autoPatchelfHook
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    (lib.getLib stdenv.cc.cc)
  ];

  env = opencode.env // {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

  # https://github.com/electron/electron/issues/31121
  # mac builds use a .app bundle which doesnt have this issue
  postPatch = lib.optionalString stdenv.isLinux ''
    BASE_PATH=packages/desktop
    FILES=(src/main/windows.ts)
    for file in "''${FILES[@]}"; do
      substituteInPlace $BASE_PATH/$file \
        --replace-fail "process.resourcesPath" "'$out/opt/opencode-desktop/resources'"
    done
  '';

  preBuild = ''
    cp -r "${electron.dist}" $HOME/.electron-dist
    chmod -R u+w $HOME/.electron-dist

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules
  '';

  buildPhase = ''
    runHook preBuild

    cd packages/desktop

    bun run build
    npx electron-builder --dir \
      --config electron-builder.config.ts \
      --config.mac.identity=null \
      --config.electronDist="$HOME/.electron-dist"

    runHook postBuild
  '';

  installPhase =
    ''
      runHook preInstall
    ''
    + lib.optionalString stdenv.hostPlatform.isDarwin ''
      mkdir -p $out/Applications
      mv dist/mac*/*.app $out/Applications
      makeWrapper "$out/Applications/OpenCode.app/Contents/MacOS/OpenCode" $out/bin/opencode-desktop
    ''
    + lib.optionalString stdenv.hostPlatform.isLinux ''
      mkdir -p $out/opt/opencode-desktop
      cp -r dist/linux*-unpacked/{resources,LICENSE*} $out/opt/opencode-desktop
      makeWrapper ${lib.getExe electron} $out/bin/opencode-desktop \
        --inherit-argv0 \
        --set ELECTRON_FORCE_IS_PACKAGED 1 \
        --add-flags $out/opt/opencode-desktop/resources/app.asar \
        --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}"
    ''
    + ''
      runHook postInstall
    '';

  autoPatchelfIgnoreMissingDeps = [
    "libc.musl-x86_64.so.1"
  ];

  meta = {
    description = "OpenCode Desktop App";
    mainProgram = "opencode-desktop";
    inherit (opencode.meta) homepage license platforms;
  };
})
