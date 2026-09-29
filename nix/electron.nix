{ callPackage, path }:
let
  version = (builtins.fromJSON (builtins.readFile ../packages/desktop/package.json)).devDependencies.electron;
in
(callPackage (path + "/pkgs/development/tools/electron/binary/generic.nix") { }) version {
  # Electron 44.4.5 SHASUMS256.txt; update with the desktop package version.
  aarch64-linux = "3bf0acab49c4ea3c9283cdb86bf3dd7204bd52a6fba6c8ae51101bdba2adae0e";
  x86_64-linux = "04586a0ec46c3283fbdaef85530f561f71f0b5e136ad0cb9ef63683615609780";
  aarch64-darwin = "a212eee63ba2f45fd83bd28f77a3e3313a336ad17a4c25adf617942eef5e0e2c";
  x86_64-darwin = "778350cc572c36484dd56c130cae96ad1a9a5b695ba22dd06abd23ba0a46c9de";
  # fetchzip hashes the unpacked headers, not the release tarball.
  headers = "sha256-QPkX+99kArlQhhbgOZe+Hsk28G5cadkUy0G0cIDtEh8=";
}
