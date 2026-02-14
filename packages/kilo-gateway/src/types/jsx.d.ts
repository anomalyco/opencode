/**
 * JSX type augmentation for OpenTUI elements
 * Extends solid-js JSX namespace to include OpenTUI elements
 */

import "solid-js"

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      box: any
      text: any
      span: any
      scrollbox: any
    }
  }
}
