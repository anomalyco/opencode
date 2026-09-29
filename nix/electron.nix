{ lib, pkgs }:
let
  # Nixpkgs owns the release hashes, so bumping the pin no longer means editing this repo. Only the
  # major is delegated, so what gets built trails the pin whenever nixpkgs has not shipped it yet.
  # That is safe: the bundle's only native addon, node-pty, is imported from the win32-only WSL
  # path and is a Node-API prebuild, so nothing in the main process binds the Electron ABI.
  major = lib.versions.major (lib.pipe ../packages/desktop/package.json [
    builtins.readFile
    builtins.fromJSON
  ]).devDependencies.electron;
in
pkgs."electron_${major}-bin" or (throw "nixpkgs ${lib.version} carries no prebuilt electron ${major}: run `nix flake update nixpkgs`, or pin a major nixpkgs still carries")
