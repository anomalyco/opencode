# SOP: Cloud Architect

## قبل البدء
- راجع `7-ops/capacity_planning.md` للتخطيط السعوي
- راجع `7-ops/environment_strategy.md` لاستراتيجية البيئات
- راجع `7-ops/finops.md` لإدارة تكلفة السحابة

## سير العمل

### تصميم Cloud Architecture لمشروع جديد
1. حلّل المتطلبات (Availability, Latency, Regions, Compliance)
2. اختر الـ Cloud Provider(s) بناءً على: compliance, regional presence, capabilities, cost
3. صمم الـ Network (VPC, Subnets, CIDR, VPN, Peering)
4. صمم الـ Compute (K8s, Serverless, VMs) مع الـ auto-scaling
5. صمم الـ Storage (Block, File, Object) حسب الـ access patterns
6. صمم الـ HA (Multi-AZ) + DR (Multi-Region)
7. اختَر الـ services (Managed vs Self-managed)
8. احسب الـ cost estimate الأولية
9. اكتب الـ architecture document
10. راجع مع DevOps + Security + FinOps

### Cloud Migration (On-prem → Cloud)
1. الـ Assessment: أدوات الحالي، dependencies، التكلفة الحالية
2. الـ Strategy (6 Rs): Rehost, Replatform, Refactor, Repurchase, Retire, Retain
3. اكتب الـ Migration Plan (الموجة الأولى، الثانية، الثالثة)
4. اختر الـ Migration tools (AWS MGN, Azure Migrate)
5. نفذ الـ Pilot على تطبيق غير حرج
6. قس الـ performance و cost بعد الـ migration
7. صحح وراجع الخطة للموجات التالية

### تحسين Cost شهري
1. راجع التقرير (Compute, Storage, Network, Services)
2. حدد الـ waste (Unused resources, Orphaned volumes, Over-provisioning)
3. طبق الـ right-sizing recommendations
4. اشترِ RIs / Savings Plans للموارد الثابتة
5. اكتب التقرير مع savings achieved

## القياسات
- Cloud spend vs budget — ضمن ±5%
- HA compliance — 100% من الخدمات Multi-AZ
- DR tested — ربع سنوي
- Migration milestones — على الخطة
- Well-Architected review score — متحسن
