import { defineRule } from "@oxlint/plugins";

import {
	isInsideBroadEffectHandler,
	isReasonTagMember,
	isTagMember,
	tagMemberFromComparison,
} from "../shared/tagged-values.ts";

export const noManualEffectErrorTagRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Use Effect tagged error handlers instead of manually branching on `_tag` in a catch handler.",
		},
		messages: {
			tag: "Use Effect.catchTag or Effect.catchTags instead of manually discriminating a tagged error in a broad Effect catch handler.",
			reason:
				"Use Effect.catchReason or Effect.catchReasons instead of manually discriminating a tagged `reason` in a broad Effect catch handler.",
		},
	},
	createOnce(context) {
		return {
			BinaryExpression(node) {
				const tagMember = tagMemberFromComparison(node);
				if (
					tagMember === undefined ||
					!isInsideBroadEffectHandler(node)
				) {
					return;
				}
				context.report({
					node,
					messageId: isReasonTagMember(tagMember) ? "reason" : "tag",
				});
			},
			SwitchStatement(node) {
				if (
					!isTagMember(node.discriminant) ||
					!isInsideBroadEffectHandler(node)
				) {
					return;
				}
				context.report({
					node,
					messageId: isReasonTagMember(node.discriminant) ? "reason" : "tag",
				});
			},
		};
	},
});
