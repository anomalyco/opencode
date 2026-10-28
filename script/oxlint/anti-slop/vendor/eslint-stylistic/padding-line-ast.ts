// Local replacements for the upstream helper imports. See UPSTREAM.md.
import type { ESTree, SourceCode, Token as SyntaxToken, Comment, Location } from "@oxlint/plugins";

type Token = SyntaxToken | Comment;

/** Line terminators recognized by the upstream padding matcher. */
export const LINEBREAKS = new Set(["\r\n", "\r", "\n", "\u2028", "\u2029"]);

/** Test a closing brace without treating comment text as punctuation. */
export const isClosingBraceToken = (token: Token): boolean =>
  token.type === "Punctuator" && token.value === "}";

/** Test a semicolon without treating comment text as punctuation. */
export const isSemicolonToken = (token: Token): boolean =>
  token.type === "Punctuator" && token.value === ";";

/** Filter the optional final semicolon when identifying block-like statements. */
export const isNotSemicolonToken = (token: Token): boolean => !isSemicolonToken(token);

/** Compare token/node boundaries, including attached comments. */
export const isTokenOnSameLine = (left: { loc: Location }, right: { loc: Location }): boolean =>
  left.loc.end.line === right.loc.start.line;

/** Recognize declarations and expressions used by the upstream IIFE matcher. */
export const isFunction = (node: ESTree.Node): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

/** Preserve the upstream multiline statement heuristic. */
export const isSingleLine = (node: ESTree.Node): boolean =>
  node.loc.start.line === node.loc.end.line;

/** Unwrap optional chaining before checking IIFE syntax. */
export const skipChainExpression = (node: ESTree.Node): ESTree.Node =>
  node.type === "ChainExpression" ? node.expression : node;

/** Only a program or function-body expression can begin a directive prologue. */
export const isTopLevelExpressionStatement = (
  node: ESTree.Node,
): node is ESTree.ExpressionStatement =>
  node.type === "ExpressionStatement" &&
  (node.parent.type === "Program" ||
    (node.parent.type === "BlockStatement" && isFunction(node.parent.parent)));

/** A single wrapping pair suffices to exclude a string from directive syntax. */
export function isParenthesized(node: ESTree.Node, sourceCode: SourceCode): boolean {
  const before = sourceCode.getTokenBefore(node);
  const after = sourceCode.getTokenAfter(node);
  return before?.value === "(" && after?.value === ")";
}
