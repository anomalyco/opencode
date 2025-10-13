import { createHighlighter, type ThemeInput } from "shiki"
import { createContext, useContext, type ParentProps } from "solid-js"

const theme: ThemeInput = {
  colors: {
    "actionBar.toggledBackground": "var(--theme-background-element)",
    "activityBarBadge.background": "var(--theme-accent)",
    "checkbox.border": "var(--theme-border)",
    "editor.background": "transparent",
    "editor.foreground": "var(--theme-text)",
    "editor.inactiveSelectionBackground": "var(--theme-background-element)",
    "editor.selectionHighlightBackground": "var(--theme-border-active)",
    "editorIndentGuide.activeBackground1": "var(--theme-border-subtle)",
    "editorIndentGuide.background1": "var(--theme-border-subtle)",
    "input.placeholderForeground": "var(--theme-text-muted)",
    "list.activeSelectionIconForeground": "var(--theme-text)",
    "list.dropBackground": "var(--theme-background-element)",
    "menu.background": "var(--theme-background-panel)",
    "menu.border": "var(--theme-border)",
    "menu.foreground": "var(--theme-text)",
    "menu.selectionBackground": "var(--theme-primary)",
    "menu.separatorBackground": "var(--theme-border)",
    "ports.iconRunningProcessForeground": "var(--theme-success)",
    "sideBarSectionHeader.background": "transparent",
    "sideBarSectionHeader.border": "var(--theme-border-subtle)",
    "sideBarTitle.foreground": "var(--theme-text-muted)",
    "statusBarItem.remoteBackground": "var(--theme-success)",
    "statusBarItem.remoteForeground": "var(--theme-text)",
    "tab.lastPinnedBorder": "var(--theme-border-subtle)",
    "tab.selectedBackground": "var(--theme-background-element)",
    "tab.selectedForeground": "var(--theme-text-muted)",
    "terminal.inactiveSelectionBackground": "var(--theme-background-element)",
    "widget.border": "var(--theme-border)",
  },
  displayName: "opencode",
  name: "opencode",
  semanticHighlighting: true,
  semanticTokenColors: {
    customLiteral: "var(--theme-syntax-function)",
    newOperator: "var(--theme-syntax-operator)",
    numberLiteral: "var(--theme-syntax-number)",
    stringLiteral: "var(--theme-syntax-string)",
  },
  tokenColors: [
    {
      scope: [
        "meta.embedded",
        "source.groovy.embedded",
        "string meta.image.inline.markdown",
        "variable.legacy.builtin.python",
      ],
      settings: {
        foreground: "var(--theme-text)",
      },
    },
    {
      scope: "emphasis",
      settings: {
        fontStyle: "italic",
      },
    },
    {
      scope: "strong",
      settings: {
        fontStyle: "bold",
      },
    },
    {
      scope: "header",
      settings: {
        foreground: "var(--theme-markdown-heading)",
      },
    },
    {
      scope: "comment",
      settings: {
        foreground: "var(--theme-syntax-comment)",
      },
    },
    {
      scope: "constant.language",
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: [
        "constant.numeric",
        "variable.other.enummember",
        "keyword.operator.plus.exponent",
        "keyword.operator.minus.exponent",
      ],
      settings: {
        foreground: "var(--theme-syntax-number)",
      },
    },
    {
      scope: "constant.regexp",
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: "entity.name.tag",
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: ["entity.name.tag.css", "entity.name.tag.less"],
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: "entity.other.attribute-name",
      settings: {
        foreground: "var(--theme-syntax-variable)",
      },
    },
    {
      scope: [
        "entity.other.attribute-name.class.css",
        "source.css entity.other.attribute-name.class",
        "entity.other.attribute-name.id.css",
        "entity.other.attribute-name.parent-selector.css",
        "entity.other.attribute-name.parent.less",
        "source.css entity.other.attribute-name.pseudo-class",
        "entity.other.attribute-name.pseudo-element.css",
        "source.css.less entity.other.attribute-name.id",
        "entity.other.attribute-name.scss",
      ],
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: "invalid",
      settings: {
        foreground: "var(--theme-error)",
      },
    },
    {
      scope: "markup.underline",
      settings: {
        fontStyle: "underline",
      },
    },
    {
      scope: "markup.bold",
      settings: {
        fontStyle: "bold",
        foreground: "var(--theme-markdown-strong)",
      },
    },
    {
      scope: "markup.heading",
      settings: {
        fontStyle: "bold",
        foreground: "var(--theme-markdown-heading)",
      },
    },
    {
      scope: "markup.italic",
      settings: {
        fontStyle: "italic",
      },
    },
    {
      scope: "markup.strikethrough",
      settings: {
        fontStyle: "strikethrough",
      },
    },
    {
      scope: "markup.inserted",
      settings: {
        foreground: "var(--theme-diff-added)",
      },
    },
    {
      scope: "markup.deleted",
      settings: {
        foreground: "var(--theme-diff-removed)",
      },
    },
    {
      scope: "markup.changed",
      settings: {
        foreground: "var(--theme-diff-context)",
      },
    },
    {
      scope: "punctuation.definition.quote.begin.markdown",
      settings: {
        foreground: "var(--theme-markdown-block-quote)",
      },
    },
    {
      scope: "punctuation.definition.list.begin.markdown",
      settings: {
        foreground: "var(--theme-markdown-list-enumeration)",
      },
    },
    {
      scope: "markup.inline.raw",
      settings: {
        foreground: "var(--theme-markdown-code)",
      },
    },
    {
      scope: "punctuation.definition.tag",
      settings: {
        foreground: "var(--theme-syntax-punctuation)",
      },
    },
    {
      scope: ["meta.preprocessor", "entity.name.function.preprocessor"],
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: "meta.preprocessor.string",
      settings: {
        foreground: "var(--theme-syntax-string)",
      },
    },
    {
      scope: "meta.preprocessor.numeric",
      settings: {
        foreground: "var(--theme-syntax-number)",
      },
    },
    {
      scope: "meta.structure.dictionary.key.python",
      settings: {
        foreground: "var(--theme-syntax-variable)",
      },
    },
    {
      scope: "meta.diff.header",
      settings: {
        foreground: "var(--theme-diff-hunk-header)",
      },
    },
    {
      scope: "storage",
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: "storage.type",
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: ["storage.modifier", "keyword.operator.noexcept"],
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: ["string", "meta.embedded.assembly"],
      settings: {
        foreground: "var(--theme-syntax-string)",
      },
    },
    {
      scope: "string.tag",
      settings: {
        foreground: "var(--theme-syntax-string)",
      },
    },
    {
      scope: "string.value",
      settings: {
        foreground: "var(--theme-syntax-string)",
      },
    },
    {
      scope: "string.regexp",
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: [
        "punctuation.definition.template-expression.begin",
        "punctuation.definition.template-expression.end",
        "punctuation.section.embedded",
      ],
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: ["meta.template.expression"],
      settings: {
        foreground: "var(--theme-text)",
      },
    },
    {
      scope: [
        "support.type.vendored.property-name",
        "support.type.property-name",
        "source.css variable",
        "source.coffee.embedded",
      ],
      settings: {
        foreground: "var(--theme-syntax-variable)",
      },
    },
    {
      scope: "keyword",
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: "keyword.control",
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: "keyword.operator",
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: [
        "keyword.operator.new",
        "keyword.operator.expression",
        "keyword.operator.cast",
        "keyword.operator.sizeof",
        "keyword.operator.alignof",
        "keyword.operator.typeid",
        "keyword.operator.alignas",
        "keyword.operator.instanceof",
        "keyword.operator.logical.python",
        "keyword.operator.wordlike",
      ],
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: "keyword.other.unit",
      settings: {
        foreground: "var(--theme-syntax-number)",
      },
    },
    {
      scope: ["punctuation.section.embedded.begin.php", "punctuation.section.embedded.end.php"],
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: "support.function.git-rebase",
      settings: {
        foreground: "var(--theme-syntax-variable)",
      },
    },
    {
      scope: "constant.sha.git-rebase",
      settings: {
        foreground: "var(--theme-syntax-number)",
      },
    },
    {
      scope: ["storage.modifier.import.java", "variable.language.wildcard.java", "storage.modifier.package.java"],
      settings: {
        foreground: "var(--theme-text)",
      },
    },
    {
      scope: "variable.language",
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "support.constant.handlebars",
        "source.powershell variable.other.member",
        "entity.name.operator.custom-literal",
      ],
      settings: {
        foreground: "var(--theme-syntax-function)",
      },
    },
    {
      scope: [
        "support.class",
        "support.type",
        "entity.name.type",
        "entity.name.namespace",
        "entity.other.attribute",
        "entity.name.scope-resolution",
        "entity.name.class",
        "storage.type.numeric.go",
        "storage.type.byte.go",
        "storage.type.boolean.go",
        "storage.type.string.go",
        "storage.type.uintptr.go",
        "storage.type.error.go",
        "storage.type.rune.go",
        "storage.type.cs",
        "storage.type.generic.cs",
        "storage.type.modifier.cs",
        "storage.type.variable.cs",
        "storage.type.annotation.java",
        "storage.type.generic.java",
        "storage.type.java",
        "storage.type.object.array.java",
        "storage.type.primitive.array.java",
        "storage.type.primitive.java",
        "storage.type.token.java",
        "storage.type.groovy",
        "storage.type.annotation.groovy",
        "storage.type.parameters.groovy",
        "storage.type.generic.groovy",
        "storage.type.object.array.groovy",
        "storage.type.primitive.array.groovy",
        "storage.type.primitive.groovy",
      ],
      settings: {
        foreground: "var(--theme-syntax-type)",
      },
    },
    {
      scope: [
        "meta.type.cast.expr",
        "meta.type.new.expr",
        "support.constant.math",
        "support.constant.dom",
        "support.constant.json",
        "entity.other.inherited-class",
        "punctuation.separator.namespace.ruby",
      ],
      settings: {
        foreground: "var(--theme-syntax-type)",
      },
    },
    {
      scope: [
        "keyword.control",
        "source.cpp keyword.operator.new",
        "keyword.operator.delete",
        "keyword.other.using",
        "keyword.other.directive.using",
        "keyword.other.operator",
        "entity.name.operator",
      ],
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: [
        "variable",
        "meta.definition.variable.name",
        "support.variable",
        "entity.name.variable",
        "constant.other.placeholder",
      ],
      settings: {
        foreground: "var(--theme-syntax-variable)",
      },
    },
    {
      scope: ["variable.other.constant", "variable.other.enummember"],
      settings: {
        foreground: "var(--theme-syntax-variable)",
      },
    },
    {
      scope: ["meta.object-literal.key"],
      settings: {
        foreground: "var(--theme-syntax-variable)",
      },
    },
    {
      scope: [
        "support.constant.property-value",
        "support.constant.font-name",
        "support.constant.media-type",
        "support.constant.media",
        "constant.other.color.rgb-value",
        "constant.other.rgb-value",
        "support.constant.color",
      ],
      settings: {
        foreground: "var(--theme-syntax-string)",
      },
    },
    {
      scope: [
        "punctuation.definition.group.regexp",
        "punctuation.definition.group.assertion.regexp",
        "punctuation.definition.character-class.regexp",
        "punctuation.character.set.begin.regexp",
        "punctuation.character.set.end.regexp",
        "keyword.operator.negation.regexp",
        "support.other.parenthesis.regexp",
      ],
      settings: {
        foreground: "var(--theme-syntax-string)",
      },
    },
    {
      scope: [
        "constant.character.character-class.regexp",
        "constant.other.character-class.set.regexp",
        "constant.other.character-class.regexp",
        "constant.character.set.regexp",
      ],
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: ["keyword.operator.or.regexp", "keyword.control.anchor.regexp"],
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: "keyword.operator.quantifier.regexp",
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: ["constant.character", "constant.other.option"],
      settings: {
        foreground: "var(--theme-syntax-keyword)",
      },
    },
    {
      scope: "constant.character.escape",
      settings: {
        foreground: "var(--theme-syntax-operator)",
      },
    },
    {
      scope: "entity.name.label",
      settings: {
        foreground: "var(--theme-text-muted)",
      },
    },
  ],
  type: "dark",
}

const highlighter = await createHighlighter({
  themes: [theme],
  langs: [],
})

type ShikiContext = typeof highlighter

const ctx = createContext<ShikiContext>()

export function ShikiProvider(props: ParentProps) {
  return <ctx.Provider value={highlighter}>{props.children}</ctx.Provider>
}

export function useShiki() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useShiki must be used within a ShikiProvider")
  }
  return value
}
