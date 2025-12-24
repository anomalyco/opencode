{
  lib,
  stdenv,
  rustPlatform,
  bun,
  pkg-config,
  dbus,
  openssl,
  glib,
  gtk3,
  libsoup_3,
  webkitgtk_4_1,
  librsvg,
  libappindicator-gtk3,
  cargo,
  rustc,
  makeBinaryWrapper,
  nodejs,
  jq,
}:
args:
let
  scripts = args.scripts;
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
rustPlatform.buildRustPackage rec {
  pname = "opencode-desktop";
  version = args.version;

  src = args.src;

  # We need to set the root for cargo, but we also need access to the whole repo.
  postUnpack = ''
    # Update sourceRoot to point to the tauri app
    sourceRoot+=/packages/desktop/src-tauri
  '';

  cargoLock = {
    lockFile = ../packages/desktop/src-tauri/Cargo.lock;
    allowBuiltinFetchGit = true;
  };

  node_modules = mkModules {
    version = version;
    src = src;
  };

  nativeBuildInputs = [
    pkg-config
    bun
    makeBinaryWrapper
    cargo
    rustc
    nodejs
    jq
  ];

  buildInputs = [
    dbus
    openssl
    glib
    gtk3
    libsoup_3
    webkitgtk_4_1
    librsvg
    libappindicator-gtk3
  ];

  preBuild = ''
    # Restore node_modules
    pushd ../../..

    # Copy node_modules from the fixed-output derivation
    # We use cp -r --no-preserve=mode to ensure we can write to them if needed, 
    # though we usually just read.
    cp -r ${node_modules}/node_modules .
    cp -r ${node_modules}/packages .

    # Fix permissions just in case
    chmod -R u+w node_modules packages
    # Patch shebangs so scripts can run
    patchShebangs node_modules

    # Copy sidecar
    mkdir -p packages/desktop/src-tauri/sidecars
    targetTriple=${stdenv.hostPlatform.rust.rustcTarget}
    cp ${args.opencode}/bin/opencode packages/desktop/src-tauri/sidecars/opencode-cli-$targetTriple
    # Merge prod config into tauri.conf.json
    jq -s '.[0] * .[1]' packages/desktop/src-tauri/tauri.conf.json packages/desktop/src-tauri/tauri.prod.conf.json > packages/desktop/src-tauri/tauri.conf.json.tmp
    mv packages/desktop/src-tauri/tauri.conf.json.tmp packages/desktop/src-tauri/tauri.conf.json

    # Build the frontend
    cd packages/desktop

    # The 'build' script runs 'bun run typecheck && vite build'.
    bun run build

    popd
  '';

  # Tauri bundles the assets during the rust build phase (which happens after preBuild).
  # It looks for them in the location specified in tauri.conf.json.

  postInstall = ''
    # Wrap the binary to ensure it finds the libraries
    wrapProgram $out/bin/opencode-desktop \
      --prefix LD_LIBRARY_PATH : ${
        lib.makeLibraryPath [
          gtk3
          webkitgtk_4_1
          librsvg
          glib
          libsoup_3
        ]
      }
  '';

  meta = with lib; {
    description = "OpenCode Desktop App";
    homepage = "https://opencode.ai";
    license = licenses.mit;
    maintainers = with maintainers; [ ];
    mainProgram = "opencode-desktop";
  };
}
