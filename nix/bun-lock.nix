target: lock:
let
  sources = builtins.concatMap (
    entry:
    let
      identity = builtins.head entry;
      parsed = builtins.match "(@[^/]+/[^@]+|[^@]+)@(.+)" identity;
      name = builtins.elemAt parsed 0;
      resolution = builtins.elemAt parsed 1;
      github = builtins.match "github:([^/]+)/([^#]+)#(.+)" resolution;
      http = builtins.match "https?://.*" resolution != null;
      registry = builtins.match "[0-9]+[.][0-9]+[.][0-9]+.*" resolution != null;
      metadata =
        if registry && builtins.length entry == 4 then
          builtins.elemAt entry 2
        else if (github != null && builtins.length entry == 4) || (http && builtins.length entry == 3) then
          builtins.elemAt entry 1
        else
          throw "Unsupported Bun source: ${identity}";
      # Bun 1.4.2 ignores libc; 1.4.4 filters it per dependency, not per source.
      compatible =
        matches [
          "aix"
          "linux"
          "sunos"
          "win32"
          "darwin"
          "android"
          "freebsd"
          "openbsd"
        ] target.os (metadata.os or [ ])
        && matches [
          "arm"
          "ppc"
          "x32"
          "x64"
          "ia32"
          "mips"
          "s390"
          "arm64"
          "ppc64"
          "s390x"
          "mipsel"
        ] target.cpu (metadata.cpu or [ ]);
      integrity = builtins.elemAt entry (builtins.length entry - 1);
      hash =
        if
          builtins.isString integrity && builtins.match "sha(1|256|512)-[A-Za-z0-9+/]+=*" integrity != null
        then
          integrity
        else
          throw "Missing Bun source integrity: ${identity}";
    in
    # Workspace files come from the repository, not isolated cache directories.
    if builtins.match "workspace:.*" resolution != null then
      [ ]
    else if !compatible then
      [ ]
    else if github != null then
      [
        {
          key = "github:${builtins.elemAt entry 2}";
          value = {
            url = "https://api.github.com/repos/${builtins.elemAt github 0}/${builtins.elemAt github 1}/tarball/${builtins.elemAt github 2}";
            inherit hash;
            name = "package.tgz";
          };
        }
      ]
    else if http then
      [
        {
          key = "tarball:${resolution}";
          value = {
            url = resolution;
            inherit hash;
            name = "package.tgz";
          };
        }
      ]
    else
      [
        {
          key = identity;
          value =
            let
              url =
                if builtins.elemAt entry 1 != "" then
                  builtins.elemAt entry 1
                else
                  "https://registry.npmjs.org/${name}/-/${builtins.baseNameOf name}-${resolution}.tgz";
            in
            {
              inherit url hash;
            }
            # Keep normal fetch names; only force extraction for non-.tgz URLs.
            // (if builtins.match ".*[.]tgz" url == null then { name = "package.tgz"; } else { });
        }
      ]
  ) (builtins.attrValues lock.packages);

  # Match Bun's Negatable accumulator, including wildcard reset order.
  matches =
    known: current: restriction:
    let
      values =
        if builtins.isString restriction then
          [ restriction ]
        else if builtins.isList restriction then
          builtins.filter builtins.isString restriction
        else
          [ ];
      flags =
        builtins.foldl'
          (
            state: value:
            if value == "" then
              state
            else if value == "any" then
              state // { wildcard = true; }
            else if value == "none" then
              state // { unknown = true; }
            else
              let
                negative = builtins.substring 0 1 value == "!";
                name = if negative then builtins.substring 1 (builtins.stringLength value) value else value;
              in
              if !(builtins.elem name known) then
                state // { unknown = state.unknown || !negative; }
              else
                {
                  added = state.added ++ (if negative then [ ] else [ name ]);
                  removed = state.removed ++ (if negative then [ name ] else [ ]);
                  wildcard = false;
                  unknown = false;
                }
          )
          {
            added = [ ];
            removed = [ ];
            wildcard = false;
            unknown = false;
          }
          values;
    in
    !(builtins.elem current flags.removed)
    && (
      if flags.wildcard then
        true
      else if flags.added != [ ] then
        builtins.elem current flags.added
      else
        flags.removed != [ ] || !flags.unknown
    );
in
if lock.lockfileVersion != 1 then
  throw "Unsupported Bun lockfile version"
else
  builtins.mapAttrs (
    identity: entries:
    let
      source = (builtins.head entries).value;
    in
    # Only source bytes are shared. Bun retains every peer context in bun.lock.
    if builtins.all (entry: entry.value == source) entries then
      source
    else
      throw "Conflicting Bun sources: ${identity}"
  ) (builtins.groupBy (entry: entry.key) sources)
