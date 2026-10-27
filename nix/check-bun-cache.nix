{
  pkgs,
  bun2nix,
  bun ? pkgs.bun,
}:
let
  fixture = ./fixtures/cache-package.tgz;
  integrity =
    algorithm:
    builtins.convertHash {
      hash = builtins.hashFile algorithm fixture;
      hashAlgo = algorithm;
      toHashFormat = "sri";
    };
  hash = integrity "sha256";
  cases = [
    {
      name = "registry";
      dependency = "1.0.0";
      entry = [
        "cache-fixture@1.0.0"
        ""
        { }
        hash
      ];
    }
    {
      name = "mirror";
      dependency = "1.0.0";
      entry = [
        "cache-fixture@1.0.0"
        "https://cdn.example.invalid/cache-fixture-1.0.0.tgz"
        { }
        hash
      ];
    }
    {
      name = "query";
      dependency = "1.0.0";
      entry = [
        "cache-fixture@1.0.0"
        "https://registry.npmjs.org/cache-fixture.tgz?review=cache"
        { }
        hash
      ];
    }
    {
      name = "http";
      dependency = "https://cdn.example.invalid/cache-fixture.tgz";
      entry = [
        "cache-fixture@https://cdn.example.invalid/cache-fixture.tgz"
        { }
        hash
      ];
    }
    {
      name = "http-sha512";
      dependency = "https://cdn.example.invalid/archive?rev=sha512";
      entry = [
        "cache-fixture@https://cdn.example.invalid/archive?rev=sha512"
        { }
        (integrity "sha512")
      ];
    }
    {
      name = "http-sha1";
      dependency = "https://cdn.example.invalid/archive?rev=sha1";
      entry = [
        "cache-fixture@https://cdn.example.invalid/archive?rev=sha1"
        { }
        (integrity "sha1")
      ];
    }
    {
      name = "github";
      dependency = "github:review/cache-fixture#0123456";
      entry = [
        "cache-fixture@github:review/cache-fixture#0123456"
        { }
        "review-cache-fixture-0123456"
        hash
      ];
    }
  ];
  check =
    case:
    let
      project = {
        name = "cache-review-${case.name}";
        version = "1.0.0";
        dependencies.cache-fixture = case.dependency;
      };
      lock = {
        lockfileVersion = 1;
        configVersion = 1;
        workspaces."" = {
          inherit (project) name dependencies;
        };
        packages.cache-fixture = case.entry;
      };
      cache =
        pkgs.callPackage ./bun-cache.nix
          {
            inherit bun bun2nix;
            fetchurl =
              source:
              let
                archive = pkgs.fetchurl source;
              in
              # Local transport preserves the source name and complete integrity.
              archive.overrideAttrs (_: {
                urls = [ "file://${fixture}" ];
              });
          }
          (
            import ./bun-lock.nix {
              os = if pkgs.stdenv.hostPlatform.isLinux then "linux" else "darwin";
              cpu = if pkgs.stdenv.hostPlatform.isAarch64 then "arm64" else "x64";
            } lock
          );
      frozen = pkgs.writeText "cache-fixture-${case.name}.lock" (builtins.toJSON lock);
    in
    pkgs.runCommand "opencode-bun-cache-${case.name}" { nativeBuildInputs = [ bun ]; } ''
      export HOME="$TMPDIR/home"
      export XDG_CONFIG_HOME="$HOME/config" XDG_DATA_HOME="$HOME/data"
      export XDG_STATE_HOME="$HOME/state" XDG_CACHE_HOME="$HOME/cache"
      export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
      mkdir -p "$HOME" "$BUN_INSTALL_CACHE_DIR" project
      cp -RL ${cache}/share/bun-cache/. "$BUN_INSTALL_CACHE_DIR/"
      chmod -R u+w "$BUN_INSTALL_CACHE_DIR"
      cd project
      cp ${pkgs.writeText "cache-fixture-${case.name}.json" (builtins.toJSON project)} package.json
      cp ${frozen} bun.lock
      bun install --frozen-lockfile --offline --linker=isolated --backend=copyfile --ignore-scripts --no-progress
      bun -e 'import assert from "node:assert/strict"; import marker from "cache-fixture"; assert.equal(marker("offline"), "verified:offline")'
      cmp bun.lock ${frozen}
      echo "${case.name}: verified archive extraction and offline package execution"
      touch "$out"
    '';
in
pkgs.linkFarm "opencode-bun-cache-checks" (
  map (case: {
    inherit (case) name;
    path = check case;
  }) cases
)
