import { dict } from "./en"

// The English the browser reads in English whatever the page language (the page copy source,
// content/source.ts). A production client build keeps only the keys it reads (script/i18n-slices.ts).
export const english: Record<string, string> = dict
