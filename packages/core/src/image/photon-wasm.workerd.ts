// workerd has no filesystem path to a photon wasm artifact. Image.Photon only
// reads this lazily and surfaces a typed ResizerUnavailableError when loading
// fails, so an empty path degrades cleanly instead of breaking module load.
export default ""
