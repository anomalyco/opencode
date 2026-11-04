import { defineRule } from "@oxlint/plugins";

import {
	isInsideBroadEffectHandler,
	isTagMember,
	tagMemberFromComparison,
} from "../shared/tagged-values.ts";

export const noManualTagComparisonRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Use Effect Match or Predicate helpers instead of manually branching on `_tag`.",
		},
		messages: {
			manualComparison:
				"Use Match.tag/Match.tags for tagged-value branching, or Predicate.isTagged for a simple reusable predicate.",
			manualSwitch:
				"Use Match.value(value).pipe(Match.tag/Match.tags/Match.tagsExhaustive) or the tagged enum `$match` helper instead of switching on `_tag`.",
		},
	},
	createOnce(context) {
		return {
			BinaryExpression(node) {
				if (
					tagMemberFromComparison(node) === undefined ||
					isInsideBroadEffectHandler(node)
				) {
					return;
				}
				context.report({ node, messageId: "manualComparison" });
			},
			SwitchStatement(node) {
				if (
					!isTagMember(node.discriminant) ||
					isInsideBroadEffectHandler(node)
				) {
					return;
				}
				context.report({ node, messageId: "manualSwitch" });
			},
		};
	},
});
