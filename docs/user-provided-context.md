# 用户提供的上下文

**生成时间**: 2026-01-19
**工作流模式**: 初始扫描 (Exhaustive模式)

## 用户指导

暂无用户提供的特定指导。

## 工作流执行参数

- **扫描级别**: Exhaustive (全面扫描)
- **工作流模式**: 初始扫描
- **项目类型**: Monorepo
- **检测到的部分**: 13个独立包

## 重点关注区域

基于项目结构，以下区域需要重点文档化：

1. **核心应用**: packages/opencode - AI驱动的开发工具
2. **桌面应用**: packages/desktop - Tauri桌面应用
3. **云端控制台**: packages/console - SST/Cloudflare部署
4. **UI组件系统**: packages/ui - 主题和组件库
5. **SDK和API**: packages/sdk - 开放API

## 特殊考虑

- 多语言支持 (README.zh-CN.md, README.zh-TW.md)
- 企业级功能 (packages/enterprise)
- 编辑器扩展 (packages/extensions, packages/plugin)
- 集成能力 (packages/slack, packages/function)
