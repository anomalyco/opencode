{
  lib,
  stdenv,
  bun,
  nodejs,
  darwin,
  callPackage,
  makeWrapper,
  glib,
  gtk3,
  gtk4,
  gsettings-desktop-schemas,
  wrapGAppsHook3,
  writableTmpDirAsHomeHook,
  autoPatchelfHook,
  copyDesktopItems,
  makeDesktopItem,
  opencode,
}:
let
  electronPin =
    (lib.pipe ../packages/desktop/package.json [
      builtins.readFile
      builtins.fromJSON
    ]).devDependencies.electron;
  electron = callPackage ./electron.nix { inherit electronPin; };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "opencode-desktop";
  inherit (opencode)
    version
    src
    node_modules
    patches
    ;

  nativeBuildInputs = [
    bun
    nodejs
    makeWrapper
    writableTmpDirAsHomeHook
  ]
  ++ lib.optionals stdenv.hostPlatform.isLinux [
    autoPatchelfHook
    copyDesktopItems
    wrapGAppsHook3
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [
    darwin.cctools
    darwin.sigtool
    # Ad-hoc sign the .app: --config.mac.identity=null below skips signing.
    darwin.autoSignDarwinBinariesHook
  ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [
    (lib.getLib stdenv.cc.cc)
    # nixpkgs' electron wrapper used to sit between opencode-desktop and the
    # Electron binary and exported these schemas through gappsWrapperArgs;
    # the wrapper below now applies the same args directly.
    gsettings-desktop-schemas
    glib
    gtk3
    gtk4
  ];

  # The makeWrapper call in installPhase is the only wrapping this needs.
  dontWrapGApps = true;

  desktopItems = lib.optional stdenv.hostPlatform.isLinux (makeDesktopItem {
    name = "ai.opencode.desktop";
    desktopName = "OpenCode";
    exec = "opencode-desktop %U";
    icon = "ai.opencode.desktop";
    # Electron derives X11 WM_CLASS from app.name.
    startupWMClass = "OpenCode";
    categories = [ "Development" ];
  });

  env = opencode.env // {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  };

  postPatch =
    # NOTE: Relax Bun version check to be a warning instead of an error
    ''
      substituteInPlace packages/script/src/index.ts \
        --replace-fail 'throw new Error(`This script requires bun@''${expectedBunVersionRange}' \
                       'console.warn(`Warning: This script requires bun@''${expectedBunVersionRange}'
    ''
    # https://github.com/electron/electron/issues/31121
    # mac builds use a .app bundle which doesnt have this issue
    + lib.optionalString stdenv.hostPlatform.isLinux ''
      substituteInPlace \
        packages/desktop/src/main/windows/appearance.ts \
        packages/desktop/src/main/service/desktop-cli.ts \
        --replace-fail "process.resourcesPath" "'$out/opt/opencode-desktop/resources'"
    '';

  preBuild = ''
    echo "electron ${electron.version} from nixpkgs ${lib.version}, package.json pins ${electronPin}"
    cp -r "${electron.dist}" $HOME/.electron-dist
    chmod -R u+w $HOME/.electron-dist

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules
  '';

  buildPhase = ''
    runHook preBuild

    cd packages/desktop

    # The bundler locates the CLI by its platform package name.
    cli_package="../cli/dist/$(bun -e 'import { getCurrentCli } from "./script/utils.ts"; console.log(getCurrentCli().package.replace("@opencode/", ""))')"
    mkdir -p "$cli_package/bin"
    cp ${lib.getExe opencode} "$cli_package/bin/opencode"
    # OPENCODE_VERSION is what the bundled CLI prints for --version, so the manifest
    # and the executable cannot drift.
    bun -e 'await Bun.write(process.argv[1], JSON.stringify({ version: process.env.OPENCODE_VERSION }) + "\n")' \
      "$cli_package/package.json"

    bun run build
    npx electron-builder --dir \
      --config electron-builder.config.ts \
      --config.mac.identity=null \
      --config.electronDist="$HOME/.electron-dist"

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
  ''
  + lib.optionalString stdenv.hostPlatform.isDarwin ''
    mkdir -p $out/Applications
    mv dist/mac*/*.app $out/Applications
    makeWrapper "$out/Applications/OpenCode.app/Contents/MacOS/OpenCode" $out/bin/opencode-desktop
  ''
  + lib.optionalString stdenv.hostPlatform.isLinux ''
    # Install electron-builder's full output. Its executable carries the Electron
    # fuses the builder flipped (cookie encryption among them); the stock nixpkgs
    # binary does not, and fuses are one-way build settings, so the builder's
    # executable is what must launch. Flipping rewrites bytes in place, so the
    # binary keeps nixpkgs' patched interpreter and RUNPATH from electron.dist
    # and still resolves every library from the store as before.
    mkdir -p $out/opt
    cp -r dist/linux*-unpacked $out/opt/opencode-desktop
    # electron-builder names the executable after the channel's appId, so find
    # it: at the unpacked root only the sandbox and crashpad helpers are
    # executable besides it, and nixpkgs strips the exec bit from the libraries.
    desktop_exe=$(find "$out/opt/opencode-desktop" -maxdepth 1 -type f -perm -0111 \
      ! -name chrome-sandbox ! -name chrome_crashpad_handler)
    test -n "$desktop_exe" && test "$(wc -l <<<"$desktop_exe")" -eq 1 || {
      echo "expected a single electron-builder executable, found:" "$desktop_exe" >&2
      exit 1
    }
    install -Dm644 resources/icons/32x32.png \
      "$out/share/icons/hicolor/32x32/apps/ai.opencode.desktop.png"
    install -Dm644 resources/icons/64x64.png \
      "$out/share/icons/hicolor/64x64/apps/ai.opencode.desktop.png"
    install -Dm644 resources/icons/128x128.png \
      "$out/share/icons/hicolor/128x128/apps/ai.opencode.desktop.png"
    install -Dm644 resources/icons/128x128@2x.png \
      "$out/share/icons/hicolor/256x256/apps/ai.opencode.desktop.png"
    install -Dm644 resources/icons/icon.png \
      "$out/share/icons/hicolor/512x512/apps/ai.opencode.desktop.png"
    install -Dm644 resources/ai.opencode.desktop.metainfo.xml \
      "$out/share/metainfo/ai.opencode.desktop.metainfo.xml"
    gappsWrapperArgsHook
    # The Wayland flags expand at launch, not when the wrapper is built.
    makeShellWrapper "$desktop_exe" $out/bin/opencode-desktop \
     "''${gappsWrapperArgs[@]}" \
     --inherit-argv0 \
     --set ELECTRON_FORCE_IS_PACKAGED 1 \
     --add-flags $out/opt/opencode-desktop/resources/app.asar \
     --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform=wayland --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}"
  ''
  + ''
    runHook postInstall
  '';

  # autoPatchelf rewrites the RUNPATH of every ELF it scans. The Electron binary
  # keeps the full library path nixpkgs baked into electron.dist, which also
  # covers DT_NEEDED entries like libnss3 and runtime dlopen()s like libGL and
  # libsecret that no scan of buildInputs would find. Only the bundled CLI and
  # the native modules need patching, so scope the pass to resources.
  dontAutoPatchelf = true;
  autoPatchelfIgnoreMissingDeps = [
    "libc.musl-x86_64.so.1"
  ];

  # patchelf's setup hook shrinks the RUNPATH of every ELF in $out, trimming
  # entries no DT_NEEDED references and dropping the libraries Electron
  # dlopen()s at runtime (libGL, vulkan, pipewire, pulseaudio, libsecret for
  # the keyring). The Electron tree ships with the RUNPATH nixpkgs baked into
  # electron.dist; keep it whole. autoPatchelf in postFixup still adds what
  # the bundled CLI and native modules need.
  dontPatchELF = true;

  postFixup = lib.optionalString stdenv.hostPlatform.isLinux ''
    autoPatchelf $out/opt/opencode-desktop/resources
  '';

  passthru = {
    # electronVersion is what ships; electronPin is what packages/desktop/package.json
    # asks for. They differ whenever nixpkgs carries no release of the pinned minor.
    electronVersion = electron.version;
    inherit electronPin;
  };

  meta = {
    description = "OpenCode Desktop App";
    mainProgram = "opencode-desktop";
    inherit (opencode.meta) homepage license platforms;
  };
})
