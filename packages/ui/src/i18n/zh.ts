import { dict as en } from "./en"

type Keys = keyof typeof en

export const dict = {
  "ui.sessionReview.title": "会话变更",
  "ui.sessionReview.diffStyle.unified": "统一",
  "ui.sessionReview.diffStyle.split": "拆分",
  "ui.sessionReview.expandAll": "全部展开",
  "ui.sessionReview.collapseAll": "全部收起",

  "ui.sessionTurn.steps.show": "显示步骤",
  "ui.sessionTurn.steps.hide": "隐藏步骤",
  "ui.sessionTurn.summary.response": "回复",
  "ui.sessionTurn.diff.showMore": "显示更多更改 ({{count}})",

  "ui.sessionTurn.retry.retrying": "重试中",
  "ui.sessionTurn.retry.inSeconds": "{{seconds}} 秒后",

  "ui.sessionTurn.status.delegating": "正在委派工作",
  "ui.sessionTurn.status.planning": "正在规划下一步",
  "ui.sessionTurn.status.gatheringContext": "正在收集上下文",
  "ui.sessionTurn.status.searchingCodebase": "正在搜索代码库",
  "ui.sessionTurn.status.searchingWeb": "正在搜索网页",
  "ui.sessionTurn.status.makingEdits": "正在修改",
  "ui.sessionTurn.status.runningCommands": "正在运行命令",
  "ui.sessionTurn.status.thinking": "思考中",
  "ui.sessionTurn.status.thinkingWithTopic": "思考 - {{topic}}",
  "ui.sessionTurn.status.gatheringThoughts": "正在整理思路",
  "ui.sessionTurn.status.consideringNextSteps": "正在考虑下一步",

  "ui.messagePart.diagnostic.error": "错误",
  "ui.messagePart.title.edit": "编辑",
  "ui.messagePart.title.write": "写入",
  "ui.messagePart.option.typeOwnAnswer": "输入自己的答案",
  "ui.messagePart.review.title": "检查你的答案",
} satisfies Partial<Record<Keys, string>>
