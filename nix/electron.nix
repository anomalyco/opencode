{ callPackage, path }:
let
  version = (builtins.fromJSON (builtins.readFile ../packages/desktop/package.json)).devDependencies.electron;
in
(callPackage (path + "/pkgs/development/tools/electron/binary/generic.nix") { }) version {
  # Electron 44.4.3 SHASUMS256.txt; update with the desktop package version.
  aarch64-linux = "61f084a5ac0f1835efc12b9db17042d92c8c617b03578f96a888acd4a05a0b10";
  x86_64-linux = "fe880a7e37160cfd4e00193bc4c713ead7a778abfe74860a2d36d86fd0be48a8";
  aarch64-darwin = "6b728f5dcfae74f3f936f2bca5b3cd9b9659ffea464f67939f004acb55425a85";
  x86_64-darwin = "015b52631d92187b552ff4e047255f596a7af4707e388a5890951f0b2645764e";
  # fetchzip hashes the unpacked headers, not the release tarball.
  headers = "sha256-QPkX+99kArlQhhbgOZe+Hsk28G5cadkUy0G0cIDtEh8=";
}
