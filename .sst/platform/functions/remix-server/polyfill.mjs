import { installGlobals } from "@remix-run/node";

// A Remix app by default has `"sideEffects": false` set in the package.json
// which will trigger ESBuild's treeshaking capabilities. This results in the
// polyfill being removed from the bundle.
//
// This behaviour can either be prevented by setting "sideEffects": true` within
// the Remix application's package.json, or by providing the `--ignore-annotations`
// argument to the ESBuild CLI.
//
// Whilst the above strategy works it will have a negative impact
// on the overall bundle size. It would be better to allow users to opt into
// the disabling of tree shaking themselves per their own needs.
//
// We therefore do not disable treeshaking in ESBuild and instead us a hack of
// performing a "+" operation against the polyfill installation code below. By
// performing an operation ESBuild will mark the code as impure and will not
// consider this line for treeshaking.
//
// Yes, it's a bit dirty for now, but its only a light amount of dirt that gives
// the user great benefit in having the required polyfills ready for their
// application, whilst also maintaining optimal bundle sizes.

installGlobals() + "PLACEHOLDER_TO_PREVENT_TREESHAKING_POLYFILL_CODE";
