# توثيق خادم OpenCode Docker

يغطي هذا الدليل تشغيل OpenCode في وضع الخادم داخل حاويات Docker.

## مقدمة

خادم OpenCode هو نشر بدون رأس لـ OpenCode يعمل كخدمة خلفية، ويمكن الوصول إليه عبر واجهة برمجة التطبيقات HTTP. توفر صورة Docker بيئة تشغيل كاملة مع جميع الأدوات اللازمة مثبتة مسبقًا، مما يجعلها مثالية لـ:

- بيئات التطوير عن بُعد
- التكامل مع CI/CD
- مثيلات البرمجة المشتركة للفريق
- تشغيل OpenCode على الخوادم بدون واجهة رسومية

## البدء السريع

شغّل خادم OpenCode بكلمة مرور آمنة:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

الوصول إلى الخادم على `http://localhost:3000`.

## متغيرات الصورة

يتوفر متغيران للصورة الأساسية:

| المتغير  | الصورة الأساسية    | الحجم  | حالة الاستخدام           |
| -------- | ------------------ | ------ | ------------------------ |
| `debian` | Debian Trixie Slim | ~500MB | موصى به لمعظم المستخدمين |
| `alpine` | Alpine Edge        | ~200MB | بصمة أدنى، سحب أسرع      |

### سحب متغيرات محددة

```bash
# Debian (موصى به)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (الحد الأدنى)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## متغيرات البيئة

| المتغير                    | الافتراضي                     | الوصف                                      |
| -------------------------- | ----------------------------- | ------------------------------------------ |
| `OPENCODE_SERVER_PASSWORD` | (لا شيء)                      | **مطلوب.** كلمة مرور لمصادقة HTTP الأساسية |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | اسم المستخدم لمصادقة HTTP الأساسية         |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | دليل التكوين                               |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | دليل ذاكرة التخزين المؤقت                  |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | دليل البيانات                              |

### خيارات الخادم (علامات CLI)

يقبل الخادم هذه الخيارات الإضافية عند تجاوز الأمر الافتراضي:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| العلامة         | الافتراضي        | الوصف                            |
| --------------- | ---------------- | -------------------------------- |
| `port--`        | `0` (عشوائي)     | المنفذ للاستماع                  |
| `hostname--`    | `127.0.0.1`      | اسم المضيف للربط                 |
| `mdns--`        | `false`          | تمكين اكتشاف خدمة mDNS           |
| `mdns-domain--` | `opencode.local` | اسم مجال mDNS المخصص             |
| `cors--`        | `[]`             | نطاقات CORS المسموح بها الإضافية |

## تحميل الأقراص

قم بتحميل هذه الأقراص لت保持 البيانات ومشاركة الموارد:

### مساحة العمل (مطلوب)

```bash
-v /path/to/workspace:/workspace
```

هنا يقوم OpenCode بتشغيل ملفات مشروعك. قم بتحميل مستودع الكود الخاص بك هنا.

### مفاتيح SSH

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

وصول للقراءة فقط إلى مفاتيح SSH لاستنساخ المستودعات الخاصة.

### تكوين Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

وراثة هوية مستخدم Git من المضيف.

### تكوين OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

保持 إعدادات OpenCode بين إعادة تشغيل الحاوية.

### ذاكرة التخزين المؤقت

```bash
-v opencode_cache:/home/opencode/.cache
```

ذاكرة تخزين مؤقت لحزم npm وخوادم اللغات والأدوات الأخرى التي تم تنزيلها.

## المنافذ

| المنفذ | البروتوكول | الوصف                                           |
| ------ | ---------- | ----------------------------------------------- |
| `3000` | HTTP       | واجهة برمجة تطبيقات الخادم الرئيسية (الافتراضي) |

يمكن إعادة تعيين المنفذ عبر علامة `-p` في Docker:

```bash
-p 8080:3000  # الوصول إلى الخادم على http://localhost:8080
```

## المستخدم والأذونات

تعمل الحاوية كمستخدم غير أساسي (`opencode`، UID 1000) لأسباب أمنية. هذا المستخدم لديه وصول `sudo` بدون كلمة مرور للمهام الإدارية:

```bash
# تنفيذ الأوامر كمستخدم opencode
docker exec -it opencode-server sudo -u opencode <command>

# الحصول على shell كمستخدم opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

إذا كنت بحاجة إلى وصول أساسي:

```bash
docker exec -it opencode-server /bin/bash
```

## الأدوات المثبتة

تتضمن الصورة هذه الأدوات بشكل مباشر:

| الأداة            | الوصف                            |
| ----------------- | -------------------------------- |
| `opencode`        | واجهة سطر أوامر OpenCode         |
| `bun`             | وقت تشغيل JavaScript ومدير الحزم |
| `bunx`            | مكافئ Bun لـ npx (تشغيل حزم npm) |
| `uv`              | مدير حزم Python                  |
| `git`             | التحكم في الإصدار                |
| `git-lfs`         | امتداد التخزين الكبير لـ Git     |
| `build-essential` | مكتبات GCC وmake والبناء         |
| `curl`            | عميل HTTP                        |
| `wget`            | أداة تنزيل الملفات               |
| `openssh-client`  | أدوات عميل ومفاتيح SSH           |
| `xz-utils`        | أدوات الضغط                      |

### استخدام bun

```bash
# تشغيل حزمة Node.js
docker exec -it opencode-server bunx create-next-app

# تثبيت التبعيات
docker exec -it opencode-server bun install
```

### استخدام uv

```bash
# تثبيت حزمة Python
docker exec -it opencode-server uv pip install pandas

# تشغيل برنامج Python
docker exec -it opencode-server uv run script.py
```

### استخدام git

```bash
# استنساخ مستودع في مساحة العمل
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## فحص الصحة

تتضمن الحاوية فحص صحة مدمج يتحقق من استجابة الخادم:

```bash
# فحص صحة الحاوية
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

نقطة نهاية الصحة ترد HTTP 200 عندما تكون صحية:

```bash
# فحص الصحة اليدوي
curl -f http://localhost:3000/health
```

تكوين فحص الصحة:

- الفترة: 30 ثانية
- المهلة: 10 ثوان
- فترة البدء: 10 ثوان
- المحاولات: 3

## مثال Docker Compose

أنشئ ملف `docker-compose.yml`:

```yaml
services:
  opencode:
    image: ghcr.io/anomalyco/opencode/server:debian
    container_name: opencode-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - OPENCODE_SERVER_PASSWORD=your_secure_password
      - OPENCODE_SERVER_USERNAME=opencode
    volumes:
      - ./workspace:/workspace
      - opencode_config:/home/opencode/.config
      - opencode_cache:/home/opencode/.cache
      - ~/.ssh:/home/opencode/.ssh:ro
      - ~/.gitconfig:/home/opencode/.gitconfig:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  opencode_config:
  opencode_cache:
```

بدء الحزمة:

```bash
docker-compose up -d
```

## البناء من المصدر

لبناء صورة الخادم من المصدر:

### استنساخ المستودع

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### بناء متغير Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### بناء متغير Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### تشغيل البناء المحلي الخاص بك

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## حل المشكلات

### عدم بدء الخادم

تحقق من السجلات:

```bash
docker logs opencode-server
```

المشاكل الشائعة:

- عدم وجود `OPENCODE_SERVER_PASSWORD` - يرفض الخادم البدء بدون مصادقة
- المنفذ مستخدم بالفعل - تغيير تعيين منفذ المضيف

### فشل المصادقة

تأكد من تطابق كلمة المرور تمامًا. يستخدم الخادم مصادقة HTTP الأساسية:

```bash
# اختبار المصادقة
curl -u opencode:your_password http://localhost:3000/health
```

### أخطاءPermissions مساحة العمل

تأكد من أن الدليل المركب قابل للكتابة بواسطة UID 1000:

```bash
# إصلاح الملكية
sudo chown -R 1000:1000 /path/to/workspace
```

### بدء بطيء

أول تشغيل يقوم بتنزيل خوادم اللغات والأدوات. تحقق من التقدم:

```bash
docker logs -f opencode-server
```

### لا يمكن للحاوية الوصول إلى الإنترنت

تحقق من تكوين DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### فشل فحص الصحة

تحقق من أن الخادم يعمل فعليًا:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### عدم عمل مفتاح SSH

تأكد من أذونات المفاتيح الصحيحة داخل الحاوية:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
