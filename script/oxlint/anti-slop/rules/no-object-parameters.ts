import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
	functionParameterBindingName,
	functionParameterTypeAnnotation,
} from "../shared/function-parameters.ts";
import {
	createTypeAliasEnvironment,
	resolvedTypeMatches,
	type TypeAliasEnvironment,
} from "../shared/type-alias-resolution.ts";
type ParameterOwner =
	| ESTree.ArrowFunctionExpression
	| ESTree.Function
	| ESTree.TSCallSignatureDeclaration
	| ESTree.TSConstructSignatureDeclaration
	| ESTree.TSConstructorType
	| ESTree.TSFunctionType
	| ESTree.TSMethodSignature;

/** Ban the broad object type on function inputs, including local aliases to object. */
export const noObjectParametersRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow object function parameters; inputs must use an owner-provided type and be parsed at their boundary.",
		},
		messages: {
			objectParameter:
				"Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.",
		},
	},
	createOnce(context) {
		let environment: TypeAliasEnvironment | null = null;

		const resolvesToObject = (type: ESTree.TSType): boolean =>
			environment !== null &&
			resolvedTypeMatches(type, environment, (resolved, matches) => {
				if (resolved.type === "TSObjectKeyword") return true;
				if (resolved.type === "TSParenthesizedType") {
					return matches(resolved.typeAnnotation);
				}
				return (
					resolved.type === "TSUnionType" && resolved.types.some(matches)
				);
			});

		const checkParameters = (node: ParameterOwner) => {
			for (const parameter of node.params) {
				const annotation = functionParameterTypeAnnotation(parameter);
				if (annotation === null || annotation === undefined) continue;
				if (!resolvesToObject(annotation.typeAnnotation)) continue;
				context.report({
					node: annotation.typeAnnotation,
					messageId: "objectParameter",
					data: { parameter: functionParameterBindingName(parameter, context.sourceCode) },
				});
			}
		};

		return {
			Program(node) {
				environment = createTypeAliasEnvironment(
					node,
					context.sourceCode.visitorKeys,
				);
			},
			ArrowFunctionExpression: checkParameters,
			FunctionDeclaration: checkParameters,
			FunctionExpression: checkParameters,
			TSCallSignatureDeclaration: checkParameters,
			TSConstructSignatureDeclaration: checkParameters,
			TSConstructorType: checkParameters,
			TSDeclareFunction: checkParameters,
			TSEmptyBodyFunctionExpression: checkParameters,
			TSFunctionType: checkParameters,
			TSMethodSignature: checkParameters,
		};
	},
});
