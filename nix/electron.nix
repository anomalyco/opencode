{ lib, pkgs, electronPin }:
let
  # Nixpkgs owns the release hashes, so bumping the pin no longer means editing this repo. Only the
  # major is delegated, so what gets built trails the pin whenever nixpkgs has not shipped it yet.
  # That is safe: the bundle ships one native addon, node-pty's Node-API prebuild, and
  # only the win32 WSL runtime loads it, so nothing in the main process binds the
  # Electron ABI.
  major = lib.versions.major electronPin;
in
pkgs."electron_${major}-bin" or (throw "nixpkgs ${lib.version} carries no prebuilt electron ${major}: run `nix flake update nixpkgs`, or pin a major nixpkgs still carries")
