# Select cache inputs without rewriting the lock or resolving semver. Bun still
# chooses the actual providers when it builds the isolated workspace graph.
lock: roots: compatible:
let
  inherit (lock) packages workspaces;
  packageKeys = builtins.attrNames packages;
  identity = entry: builtins.match "(@[^/]+/[^@]+|[^@]+)@(.+)" (builtins.head entry);
  byName = builtins.groupBy (key: builtins.elemAt (identity packages.${key}) 0) packageKeys;
  byEntry = builtins.groupBy (key: builtins.hashString "sha256" (builtins.toJSON packages.${key})) packageKeys;

  parent =
    key:
    let
      scoped = builtins.match "(.*)/@[^/]+/[^/]+" key;
      unscoped = builtins.match "(.*)/[^/@][^/]*" key;
    in
    if scoped != null then (if builtins.head scoped == "." then "" else builtins.head scoped)
    else if builtins.match "@[^/]+/[^/]+" key != null then ""
    else if unscoped == null || builtins.head unscoped == "." then ""
    else builtins.head unscoped;

  resolve =
    owner: name:
    let
      key = if owner == "" then name else "${owner}/${name}";
    in
    if builtins.hasAttr key packages then [ key ]
    else if owner == "" then [ ]
    else resolve (parent owner) name;

  peerRange =
    name: range:
    let
      catalog = builtins.match "catalog:(.*)" range;
      group = if catalog == null then "" else builtins.head catalog;
    in
    if catalog == null then range
    else if group == "" then (lock.catalog or { }).${name} or range
    else ((lock.catalogs or { }).${group} or { }).${name} or range;

  dependencies =
    owner: meta:
    builtins.concatMap (name: resolve owner name) (
      builtins.attrNames ((meta.dependencies or { }) // (meta.optionalDependencies or { }) // (meta.devDependencies or { }))
    )
    ++ builtins.concatMap (
      name:
      let
        alias = builtins.match "npm:(@[^/]+/[^@]+|[^@]+)(@.*)?" (peerRange name meta.peerDependencies.${name});
      in
      # Peers can bind by name/version rather than placement. Prefetch their
      # candidates; the frozen install selects a provider in each context.
      resolve owner name ++ (byName.${if alias == null then name else builtins.head alias} or [ ])
    ) (builtins.attrNames (meta.peerDependencies or { }));

  workspaceEdges =
    path:
    let
      workspace = workspaces.${path};
      owner = if path == "" then "" else workspace.name;
      rootEntry = packages.${owner} or null;
      # The lock uses a ./ prefix for an importer shadowed by a root package.
      scope =
        if owner != "" && rootEntry != null && builtins.elemAt (identity rootEntry) 1 != "workspace:${path}"
        then "./${owner}"
        else owner;
    in
    dependencies scope workspace;

  reached = builtins.genericClosure {
    startSet = map (key: { inherit key; }) (builtins.concatMap workspaceEdges roots);
    operator =
      node:
      let
        entry = packages.${node.key};
        resolution = builtins.elemAt (identity entry) 1;
        workspace = builtins.match "workspace:(.*)" resolution;
        meta = builtins.elemAt entry (if builtins.match "[0-9]+[.][0-9]+[.][0-9]+.*" resolution != null then 2 else 1);
        edges =
          if workspace != null then workspaceEdges (builtins.head workspace)
          else if !compatible meta then [ ]
          else dependencies node.key meta ++ byEntry.${builtins.hashString "sha256" (builtins.toJSON entry)};
      in
      map (key: { inherit key; }) edges;
  };
in
map (node: packages.${node.key}) reached
