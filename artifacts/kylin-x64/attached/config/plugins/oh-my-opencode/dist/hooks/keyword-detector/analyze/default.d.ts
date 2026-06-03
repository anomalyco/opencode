/**
 * Analyze mode keyword detector.
 *
 * Triggers on analysis-related keywords across multiple languages:
 * - English: analyze, analyse, investigate, examine, research, study, deep-dive, inspect, audit, evaluate, assess, review, diagnose, scrutinize, dissect, debug, comprehend, interpret, breakdown, understand, why is, how does, how to
 * - Korean: 분석, 조사, 파악, 연구, 검토, 진단, 이해, 설명, 원인, 이유, 뜯어봐, 따져봐, 평가, 해석, 디버깅, 디버그, 어떻게, 왜, 살펴
 * - Japanese: 分析, 調査, 解析, 検討, 研究, 診断, 理解, 説明, 検証, 精査, 究明, デバッグ, なぜ, どう, 仕組み
 * - Chinese: 调查, 检查, 剖析, 深入, 诊断, 解释, 调试, 为什么, 原理, 搞清楚, 弄明白
 * - Vietnamese: phân tích, điều tra, nghiên cứu, kiểm tra, xem xét, chẩn đoán, giải thích, tìm hiểu, gỡ lỗi, tại sao
 */
export declare const ANALYZE_PATTERN: RegExp;
export declare const ANALYZE_MESSAGE = "[analyze-mode]\nANALYSIS MODE. Gather context before diving deep:\n\nCONTEXT GATHERING (parallel):\n- 1-2 explore agents (codebase patterns, implementations)\n- 1-2 librarian agents (if external library involved)\n- Direct tools: Grep, AST-grep, LSP for targeted searches\n\nIF COMPLEX - DO NOT STRUGGLE ALONE. Consult specialists:\n- **Oracle**: Conventional problems (architecture, debugging, complex logic)\n- **Artistry**: Non-conventional problems (different approach needed)\n\nSYNTHESIZE findings before proceeding.";
