import { defineRule, type ESTree } from "@oxlint/plugins";

const equalityOperators = new Set(["==", "===", "!=", "!=="]);

export const preferEffectMatchRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Use Match from Effect for chained literal ternaries over the same value.",
		},
		messages: {
			preferMatch:
				"Use Match from Effect instead of a chained literal ternary.",
		},
	},
	createOnce(context) {
		const isLiteral = (node: ESTree.Node): boolean =>
			node.type === "Literal" ||
			(node.type === "TemplateLiteral" && node.expressions.length === 0);

		const comparedValue = (node: ESTree.Expression): string | undefined => {
			if (
				node.type !== "BinaryExpression" ||
				!equalityOperators.has(node.operator)
			) {
				return undefined;
			}
			if (isLiteral(node.left)) return context.sourceCode.getText(node.right);
			if (isLiteral(node.right)) return context.sourceCode.getText(node.left);
			return undefined;
		};

		return {
			ConditionalExpression(node) {
				if (node.parent?.type === "ConditionalExpression") return;
				const value = comparedValue(node.test);
				if (value === undefined) return;

				let alternate = node.alternate;
				let literalChecks = 1;
				while (alternate.type === "ConditionalExpression") {
					if (comparedValue(alternate.test) !== value) return;
					literalChecks += 1;
					alternate = alternate.alternate;
				}

				if (literalChecks > 1) {
					context.report({ node, messageId: "preferMatch" });
				}
			},
		};
	},
});
