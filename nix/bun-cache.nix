{
  lib,
  runCommand,
  symlinkJoin,
  linkFarm,
  libarchive,
  fetchurl,
  bun,
  cacheEntryCreator,
}:
sources:
let
  # Pinned bun2nix uses URL-only HTTP keys; Bun 1.4.4 requires integrity keys.
  # https://github.com/nix-community/bun2nix/pull/108#issuecomment-6442004506
  modernHttp = identity: lib.versionAtLeast bun.version "1.4.4" && lib.hasPrefix "tarball:" identity;
  extract =
    archive: destination: ''
      mkdir -p "${destination}"
      bsdtar --extract --file "${archive}" --directory "${destination}" \
        --strip-components=1 --no-same-owner --no-same-permissions
      chmod -R u+rwX "${destination}"
    '';
  legacy = symlinkJoin {
    name = "bun-cache";
    paths = lib.mapAttrsToList (
      name: source:
      runCommand "bun-pkg-${name}" { nativeBuildInputs = [ libarchive cacheEntryCreator ]; } ''
        package="$out/share/bun-packages/"${lib.escapeShellArg name}
        ${extract (fetchurl source) "$package"}
        cache_entry_creator --out "$out/share/bun-cache" --name ${lib.escapeShellArg name} \
          --package "$package"
      ''
    ) (lib.filterAttrs (name: _: !modernHttp name) sources);
  };
  http = builtins.mapAttrs (
    _: source:
    let
      algorithm = builtins.head (builtins.match "(sha[0-9]+)-.*" source.hash);
      digest = builtins.convertHash {
        hash = source.hash;
        toHashFormat = "base16";
      };
    in
    {
      name = "@T@${algorithm}-${builtins.substring 0 32 digest}@@@1";
      inherit source;
    }
  ) (lib.filterAttrs (name: _: modernHttp name) sources);
  entries = builtins.mapAttrs (
    name: values:
    let
      source = (builtins.head values).source;
    in
    # Bun truncates cache keys, but different complete digests must never share package bytes.
    assert builtins.all (value: value.source.hash == source.hash) values;
    {
      name = "share/bun-cache/${name}";
      path = runCommand "bun-http-package" { nativeBuildInputs = [ libarchive ]; } (
        extract (fetchurl source) "$out"
      );
    }
  ) (builtins.groupBy (entry: entry.name) (builtins.attrValues http));
in
if entries == { } then
  legacy
else
  symlinkJoin {
    name = "bun-cache";
    paths = [
      legacy
      (linkFarm "bun-http-cache" (builtins.attrValues entries))
    ];
  }
