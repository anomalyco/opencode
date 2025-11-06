{ optionalPackagesFile, hash, lib, stdenvNoCC, bun, cacert, curl }:
args:
stdenvNoCC.mkDerivation {
  pname = "opencode-node_modules";
  version = args.version;
  src = args.src;

  impureEnvVars =
    lib.fetchers.proxyImpureEnvVars
    ++ [
      "GIT_PROXY_COMMAND"
      "SOCKS_SERVER"
    ];

  nativeBuildInputs = [ bun cacert curl ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    export HOME=$(mktemp -d)
    export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
    bun install \
      --frozen-lockfile \
      --ignore-scripts \
      --no-progress

    cp ${optionalPackagesFile} optional-packages.txt

    bun --bun ${args.optionalMetadataScript} optional-packages.txt > optional-metadata.txt

    echo "Optional package metadata:"
    cat optional-metadata.txt
    while IFS=$'\t' read -r name version sha; do
      [ -z "$name" ] && continue
      scope="''${name%%/*}"
      remainder="''${name#*/}"
      if [ "$scope" = "$name" ]; then
        scope=""
        remainder="$name"
      fi

      base="''${remainder##*/}"
      encoded_scope="''${scope//@/%40}"

      url="https://registry.npmjs.org/''${remainder}/-/''${base}-''${version}.tgz"
      dest="node_modules/''${remainder}"
      if [ -n "$scope" ]; then
        url="https://registry.npmjs.org/''${encoded_scope}/''${remainder}/-/''${base}-''${version}.tgz"
        dest="node_modules/''${scope}/''${remainder}"
      fi

      tmp=$(mktemp)
      curl --fail --location --silent --show-error --tlsv1.2 "$url" -o "$tmp"
      bun --bun ${args.verifyShaScript} "$tmp" "$sha"

      mkdir -p "$dest"
      tar -xzf "$tmp" -C "$dest" --strip-components=1 package
      rm -f "$tmp"

      echo "Installed optional package $name -> $dest"

      for ws in packages/*; do
        [ -d "$ws/node_modules" ] || continue
        ws_dest="$ws/node_modules/$remainder"
        if [ -n "$scope" ]; then
          ws_dest="$ws/node_modules/$scope/$remainder"
        fi
        mkdir -p "$(dirname "$ws_dest")"
        rm -rf "$ws_dest"
        target="$(realpath --relative-to="$(dirname "$ws_dest")" "$dest")"
        ln -s "$target" "$ws_dest"
      done
    done < optional-metadata.txt

    rm -f optional-packages.txt optional-metadata.txt

    bun --bun ${args.canonicalizeScript}

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    while IFS= read -r dir; do
      rel="''${dir#./}"
      dest="$out/$rel"
      mkdir -p "$(dirname "$dest")"
      cp -R "$dir" "$dest"
    done < <(find . -type d -name node_modules -prune)
    runHook postInstall
  '';

  dontFixup = true;

  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
  outputHash = hash;
}
