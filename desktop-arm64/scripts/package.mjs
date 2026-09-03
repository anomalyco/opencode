import * as mod from "@electron/packager";

const packager =
  typeof mod === "function"
    ? mod
    : (mod.default ?? mod.packager ?? null);

if (typeof packager !== "function") {
  console.error("cannot locate @electron/packager entry:", Object.keys(mod));
  process.exit(1);
}

const paths = await packager({
  dir: ".",
  out: "release",
  platform: "win32",
  arch: "arm64",
  executableName: "opencode-arm",
  overwrite: true,
  prune: false,
  ignore: [
    /^\/node_modules($|\/)/,
    /^\/src($|\/)/,
    /^\/test($|\/)/,
    /^\/scripts($|\/)/,
    /^\/release($|\/)/,
    /^\/\.git($|\/)/,
    /^\/\.github($|\/)/,
    /^\/tsconfig\.json$/,
    /^\/test-output\.txt$/,
  ],
  win32metadata: {
    ProductName: "OpenCode ARM",
    CompanyName: "OpenCode ARM contributors",
    FileDescription: "Native coding agent for Windows on ARM64",
  },
});

console.log("packaged:");
for (const p of paths) console.log(" ", p);
