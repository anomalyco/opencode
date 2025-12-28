declare module "lang-map" {
  /** Returned by calling `map()` */
  export interface MapReturn {
    /** All extensions keyed by language name */
    extensions: Record<string, string[]>
    /** All languages keyed by file-extension */
    languages: Record<string, string[]>
  }

  /**
   * Calling `map()` gives you the raw lookup tables:
   *
   * ```js
   * const { extensions, languages } = map();
   * ```
   */
  function map(): MapReturn

  /** Static method: get extensions for a given language */
  namespace map {
    function extensions(language: string): string[]
    /** Static method: get languages for a given extension */
    function languages(extension: string): string[]
  }

  export = map
}
