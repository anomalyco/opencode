{
  lib,
  stdenvNoCC,
  bun,
  nodejs,
  electron,
  makeWrapper,
  makeDesktopItem,
  ripgrep,
  writeText,
  opencode,
}:
let
  desktopItem = makeDesktopItem {
    name = "opencode-desktop";
    desktopName = "OpenCode";
    comment = "OpenCode Desktop App";
    exec = "opencode-desktop";
    icon = "opencode-desktop";
    categories = [ "Development" ];
    startupWMClass = "OpenCode";
  };

  # electron-builder mutates helper Info.plist files after copying Electron.app.
  # Nix's Electron app is read-only, so make the copied bundle writable first.
  darwinAfterExtract = writeText "opencode-desktop-after-extract.cjs" ''
    const fs = require("node:fs/promises")
    const path = require("node:path")

    async function chmodWritable(file) {
      const stat = await fs.lstat(file)
      await fs.chmod(file, stat.mode | 0o200)
      if (!stat.isDirectory()) return
      await Promise.all((await fs.readdir(file)).map((entry) => chmodWritable(path.join(file, entry))))
    }

    module.exports = async (context) => {
      if (context.electronPlatformName !== "darwin") return
      await chmodWritable(path.join(context.appOutDir, "Electron.app"))
    }
  '';
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencode-desktop";
  inherit (opencode)
    version
    src
    node_modules
    patches
    ;

  nativeBuildInputs = [
    bun
    nodejs # for patchShebangs node_modules
    makeWrapper
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .
    chmod -R u+w node_modules packages
    patchShebangs node_modules
    patchShebangs packages/*/node_modules

    runHook postConfigure
  '';

  env.OPENCODE_CHANNEL = "prod";
  env.OPENCODE_DISABLE_UPDATER = "true";
  env.OPENCODE_DISABLE_MODELS_FETCH = opencode.OPENCODE_DISABLE_MODELS_FETCH;
  env.MODELS_DEV_API_JSON = opencode.MODELS_DEV_API_JSON;
  env.OPENCODE_VERSION = finalAttrs.version;

  runtimePath = lib.makeBinPath [ ripgrep ];

  electronBuilderFlags = [
    "--config"
    "electron-builder.config.ts"
    "--config.extraMetadata.version=${finalAttrs.version}"
    "--config.electronVersion=${electron.version}"
  ];

  buildPhase = ''
    runHook preBuild

    cd packages/desktop
    bun ./scripts/prebuild.ts
    bun run build
  ''
  + lib.optionalString stdenvNoCC.hostPlatform.isDarwin ''
    bunx electron-builder --mac dir ${
      lib.escapeShellArgs (
        finalAttrs.electronBuilderFlags
        ++ [
          "--config.electronDist=${electron}/Applications"
          "--config.afterExtract=${darwinAfterExtract}"
          "--config.mac.identity=null"
          "--config.mac.hardenedRuntime=false"
          "--config.mac.notarize=false"
        ]
      )
    }
  ''
  + lib.optionalString stdenvNoCC.hostPlatform.isLinux ''
    bunx electron-builder --linux dir ${
      lib.escapeShellArgs (
        finalAttrs.electronBuilderFlags
        ++ [
          "--config.electronDist=${electron}/libexec/electron"
          "--config.linux.executableName=opencode"
        ]
      )
    }
  ''
  + ''

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

  ''
  + lib.optionalString stdenvNoCC.hostPlatform.isDarwin ''
    mkdir -p $out/Applications $out/bin
    cp -R dist/mac*/OpenCode.app $out/Applications/
    wrapProgram $out/Applications/OpenCode.app/Contents/MacOS/OpenCode \
      --prefix PATH : ${finalAttrs.runtimePath}
    makeWrapper $out/Applications/OpenCode.app/Contents/MacOS/OpenCode $out/bin/opencode-desktop
  ''
  + lib.optionalString stdenvNoCC.hostPlatform.isLinux ''
    mkdir -p $out/share/opencode-desktop $out/bin
    cp -R dist/linux-unpacked/. $out/share/opencode-desktop/
    makeWrapper $out/share/opencode-desktop/opencode $out/bin/opencode-desktop \
      --prefix PATH : ${finalAttrs.runtimePath}

    install -Dm644 resources/icons/32x32.png $out/share/icons/hicolor/32x32/apps/opencode-desktop.png
    install -Dm644 resources/icons/64x64.png $out/share/icons/hicolor/64x64/apps/opencode-desktop.png
    install -Dm644 resources/icons/128x128.png $out/share/icons/hicolor/128x128/apps/opencode-desktop.png
    install -Dm644 resources/icons/128x128@2x.png $out/share/icons/hicolor/256x256/apps/opencode-desktop.png
    cp -R ${desktopItem}/share/applications $out/share/
  ''
  + ''

    runHook postInstall
  '';

  meta = {
    description = "OpenCode Desktop App";
    homepage = "https://opencode.ai";
    license = lib.licenses.mit;
    mainProgram = "opencode-desktop";
    inherit (opencode.meta) platforms;
  };
})
