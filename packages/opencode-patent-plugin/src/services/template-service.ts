/**
 * 模板访问服务
 *
 * 统一的模板访问入口，封装 templates/ 目录下的各类专利文件模板。
 */

export {
  specificationTemplate,
  SPEC_LENGTH_GUIDE,
} from "../templates/specification.js"

export {
  getClaimsTemplate,
} from "../templates/claims.js"

export {
  responseTemplate,
  responseTemplateNovelty,
  responseTemplateInventiveStep,
} from "../templates/response.js"

export {
  reexamTemplate,
} from "../templates/reexam.js"

export {
  invalidationAttackTemplate,
  invalidationDefendTemplate,
} from "../templates/invalidation.js"

export {
  renderTemplate,
  type TemplateParams,
} from "../templates/index.js"
