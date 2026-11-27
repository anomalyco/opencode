import { interpolate } from "~/i18n"
import { english } from "~/i18n/english"
import { pressContent } from "~/lib/press-content"

/** The Press page's English copy (its heading ids follow the English in every language). */
export const pressSource = pressContent(
  (key, params) => interpolate(english[key], params),
  (path) => path,
)
