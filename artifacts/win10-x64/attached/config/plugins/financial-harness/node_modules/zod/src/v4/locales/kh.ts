import type * as errors from "../core/errors.js";
import km from "./km.js";

/** @deprecated Use `km` instead. */
export default function (): { localeError: errors.$ZodErrorMap } {
  return km();
}
