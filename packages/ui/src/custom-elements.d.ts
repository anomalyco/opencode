/**
 * TypeScript declaration for the <file-diff> custom element.
 * This tells TypeScript that <file-diff> is a valid JSX element in SolidJS.
 * Required for using the precision-diffs web component in .tsx files.
 */
declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "file-diff": HTMLAttributes<HTMLElement>
    }
  }
}

export {}
