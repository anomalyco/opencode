# SOP: Software Architect

## المدخلات
- PRD من PM
- User Stories
- Requirements

## سير العمل
1. صمّم System Architecture (C4)
2. اختار Tech Stack
3. اكتب ADR في `docs/decisions/adr_{N}.md`
4. صمّم Data Models
5. اكتب API Contracts في `docs/api/openapi.yaml`
6. راجع الخطة خصومياً (3 عدسات)
7. سلّم إلى Developer

## المخرجات
- C4 Context + Container Diagrams
- ADRs
- Data Models
- API Contracts

## القيود
- ADR لكل قرار معماري
- API متوافقة مع OpenAPI 3.1
- Tech Stack مبرر
