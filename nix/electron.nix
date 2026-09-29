{ lib, pkgs }:
let
  pinned = (builtins.fromJSON (builtins.readFile ../packages/desktop/package.json)).devDependencies.electron;
  major = lib.versions.major pinned;
  # Nixpkgs owns the release hashes (pkgs/development/tools/electron/binary/info.json, refreshed by
  # its update.py from electron's SHASUMS256.txt), so bumping the desktop's electron pin no longer
  # means copying hashes into this repo. What it resolves to can trail the pin, and that is safe:
  # patch releases keep the Chromium and Node ABI, and the desktop loads node-pty from a Node-API
  # prebuild, which is ABI-stable across both.
in
pkgs."electron_${major}-bin" or (throw "nixpkgs ${lib.version} has no prebuilt electron ${major}, run `nix flake update nixpkgs`")
