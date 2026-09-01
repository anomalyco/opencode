import { plugin } from "bun"

// Filming only: accelerate the existing cleanup policy without modifying either checkout.
plugin({
  name: "hidden-approval-clock",
  setup(build) {
    build.onLoad({ filter: /[/\\]location-activity\.ts$/ }, async (args) => {
      const source = await Bun.file(args.path).text()
      if (!source.includes("layer: layer(),")) throw new Error("LocationActivity timing seam changed")
      return {
        loader: "ts",
        contents: source.replace(
          "layer: layer(),",
          'layer: layer({ timeToLive: "8 seconds", sweepInterval: "1 second" }),',
        ),
      }
    })
  },
})
