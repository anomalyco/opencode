/**
 * Search mode keyword detector.
 *
 * Triggers on search-related keywords across multiple languages:
 * - English: search, find, locate, lookup, explore, discover, scan, grep, query, browse, detect, trace, seek, track, pinpoint, hunt, where is, show me, list all
 * - Korean: 검색, 찾아, 탐색, 조회, 스캔, 서치, 뒤져, 찾기, 어디, 추적, 탐지, 찾아봐, 찾아내, 보여줘, 목록
 * - Japanese: 検索, 探して, 見つけて, サーチ, 探索, スキャン, どこ, 発見, 捜索, 見つけ出す, 一覧
 * - Chinese: 搜索, 查找, 寻找, 查询, 检索, 定位, 扫描, 发现, 在哪里, 找出来, 列出
 * - Vietnamese: tìm kiếm, tra cứu, định vị, quét, phát hiện, truy tìm, tìm ra, ở đâu, liệt kê
 */
export declare const SEARCH_PATTERN: RegExp;
export declare const SEARCH_MESSAGE = "[search-mode]\nMAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:\n- explore agents (codebase patterns, file structures, ast-grep)\n- librarian agents (remote repos, official docs, GitHub examples)\nPlus direct tools: Grep, ripgrep (rg), ast-grep (sg)\nNEVER stop at first result - be exhaustive.";
