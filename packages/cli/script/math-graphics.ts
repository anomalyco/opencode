import type { BunPlugin } from "bun"
import path from "node:path"

export function mathGraphicsPlugin(target: { os: string; arch: string; abi?: "musl" }): BunPlugin {
  return {
    name: "opencode-math-graphics",
    setup(build) {
      build.onLoad({ filter: /mathjax[/\\]node-main-setup\.cjs$/ }, (args) => {
        const directory = path.dirname(args.path)
        const font = path.dirname(Bun.resolveSync("@mathjax/mathjax-newcm-font/svg.js", args.path))
        // MathJax's eval-created importer is invisible to Bun. Keep lazy loading,
        // but expose TeX components and SVG font shards as literal imports.
        const imports = [
          ...["input/tex.js", "output/svg.js", ...new Bun.Glob("input/tex/extensions/*.js").scanSync(directory)]
            .sort()
            .map(
              (file) =>
                `${JSON.stringify(`/opencode-mathjax/${file.replaceAll("\\", "/")}`)}: () => import(${JSON.stringify(path.join(directory, file))})`,
            ),
          ...["svg.js", ...new Bun.Glob("svg/dynamic/*.js").scanSync(font)]
            .sort()
            .map(
              (file) =>
                `${JSON.stringify(`@mathjax/mathjax-newcm-font/${file.replaceAll("\\", "/")}`)}: () => import(${JSON.stringify(path.join(font, file))})`,
            ),
        ]
        return {
          loader: "js",
          contents: `global.require = require;
global.MathJax ??= {};
global.MathJax.__dirname = "/opencode-mathjax";
const components = {${imports.join(",\n")}};
global.MathJax.loader = { ...global.MathJax.loader, require(file) {
  const load = components[file.replace(/^file:\\/\\//, "")];
  if (!load) throw new Error("MathJax component not bundled: " + file);
  return load();
}};`,
        }
      })
      build.onLoad({ filter: /@resvg[/\\]resvg-js[/\\]js-binding\.js$/ }, (args) => {
        const suffix = target.os === "linux" ? `-${target.abi ?? "gnu"}` : target.os === "win32" ? "-msvc" : ""
        const binding = Bun.resolveSync(`@resvg/resvg-js-${target.os}-${target.arch}${suffix}`, args.path)
        return { loader: "js", contents: `module.exports = require(${JSON.stringify(binding)})` }
      })
    },
  }
}
