import type * as errors from "../core/errors.js";
import uk from "./uk.js";

/** @deprecated Use `uk` instead. */
export default function (): { localeError: errors.$ZodErrorMap } {
  return uk();
}
