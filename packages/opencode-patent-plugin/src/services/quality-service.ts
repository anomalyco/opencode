/**
 * 质量检查服务
 *
 * 封装 7 维度质量评估 + 自动迭代修复引擎。
 * 底层实现来自 utils/quality-loop.ts，此文件提供服务层入口。
 */

export {
  QUALITY_DIMENSIONS,
  qualityLoop,
  evaluateQuality,
  formatQualityReport,
  type QualityReport,
  type QualityLoopOptions,
  type DimensionScore,
  type DimensionKey,
} from "../utils/quality-loop.js"
