import { plugin } from "bun"

// Simulate an install without the optional auth peers: loading either one fails like a missing package.
plugin({
  name: "hide-optional-peers",
  setup(build) {
    build.onLoad(
      { filter: /node_modules[\\/](@aws-sdk[\\/]credential-providers|google-auth-library)[\\/]/ },
      (input) => {
        const name = input.path.includes("google-auth-library")
          ? "google-auth-library"
          : "@aws-sdk/credential-providers"
        console.error(`loaded ${name}`)
        throw Object.assign(new Error(`Cannot find package '${name}'`), { code: "ERR_MODULE_NOT_FOUND" })
      },
    )
  },
})
