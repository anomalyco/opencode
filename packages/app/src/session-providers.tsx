/** @jsxImportSource solid-js */
import type { ParentProps } from "solid-js"
import { createComponent } from "solid-js/web"
import { AnnotationProvider } from "@/context/annotation-store"
import { BrowserProvider } from "@/context/browser-store"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { TerminalProvider } from "@/context/terminal"

export function SessionProviders(props: ParentProps) {
  return createComponent(TerminalProvider, {
    get children() {
      return createComponent(FileProvider, {
        get children() {
          return createComponent(PromptProvider, {
            get children() {
              return createComponent(CommentsProvider, {
                get children() {
                  return createComponent(BrowserProvider, {
                    get children() {
                      return createComponent(AnnotationProvider, {
                        get children() {
                          return props.children
                        },
                      })
                    },
                  })
                },
              })
            },
          })
        },
      })
    },
  })
}
