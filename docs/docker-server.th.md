# เอกสาร OpenCode Server Docker

คู่มือนี้ครอบคลุมการรัน OpenCode ในโหมดเซิร์ฟเวอร์ภายในคอนเทนเนอร์ Docker

## บทนำ

OpenCode Server คือการติดตั้ง OpenCode แบบ headless ที่ทำงานเป็นเซิร์ฟเวอร์พื้นหลัง เข้าถึงได้ผ่าน HTTP API อิมเมจ Docker มีสภาพแวดล้อมรันไทม์ที่สมบูรณ์พร้อมเครื่องมือที่จำเป็นทั้งหมดติดตั้งไว้แล้ว ทำให้เหมาะสำหรับ:

- สภาพแวดล้อมการพัฒนาระยะไกล
- การรวม CI/CD
- อินสแตนซ์การเขียนโค้ดที่ใช้ร่วมกันในทีม
- การรัน OpenCode บนเซิร์ฟเวอร์ที่ไม่มี GUI

## เริ่มต้นอย่างรวดเร็ว

รัน OpenCode Server ด้วยรหัสผ่านที่ปลอดภัย:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

เข้าถึงเซิร์ฟเวอร์ที่ `http://localhost:3000`

## ตัวแปรของอิมเมจ

มีตัวแปรอิมเมจพื้นฐานสองแบบให้เลือก:

| ตัวแปร   | อิมเมจพื้นฐาน      | ขนาด   | กรณีการใช้งาน                  |
| -------- | ------------------ | ------ | ------------------------------ |
| `debian` | Debian Trixie Slim | ~500MB | แนะนำสำหรับผู้ใช้ส่วนใหญ่      |
| `alpine` | Alpine Edge        | ~200MB | ขนาดเล็กสุด, ดาวน์โหลดเร็วกว่า |

### การดึงตัวแปรเฉพาะ

```bash
# Debian (แนะนำ)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (ขนาดเล็ก)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## ตัวแปรสภาพแวดล้อม

| ตัวแปร                     | ค่าเริ่มต้น                   | คำอธิบาย                                             |
| -------------------------- | ----------------------------- | ---------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (ไม่มี)                       | **จำเป็น.** รหัสผ่านสำหรับ HTTP Basic authentication |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | ชื่อผู้ใช้สำหรับ HTTP Basic authentication           |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | ไดเรกทอรีการตั้งค่า                                  |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | ไดเรกทอรีแคช                                         |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | ไดเรกทอรีข้อมูล                                      |

### ตัวเลือกเซิร์ฟเวอร์ (CLI Flags)

เซิร์ฟเวอร์รับตัวเลือกเพิ่มเติมเหล่านี้เมื่อแทนที่คำสั่งเริ่มต้น:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | ค่าเริ่มต้น      | คำอธิบาย                      |
| --------------- | ---------------- | ----------------------------- |
| `--port`        | `0` (สุ่ม)       | พอร์ตสำหรับรับการเชื่อมต่อ    |
| `--hostname`    | `127.0.0.1`      | ชื่อโฮสต์สำหรับผูกมัด         |
| `--mdns`        | `false`          | เปิดใช้งานการค้นหาบริการ mDNS |
| `--mdns-domain` | `opencode.local` | ชื่อโดเมน mDNS ที่กำหนดเอง    |
| `--cors`        | `[]`             | โดเมนเพิ่มเติมที่อนุญาต CORS  |

## การ Mount Volume

Mount volumes เหล่านี้เพื่อคงข้อมูลไว้และแบ่งปันทรัพยากร:

### Workspace (จำเป็น)

```bash
-v /path/to/workspace:/workspace
```

นี่คือที่ที่ OpenCode ทำงานกับไฟล์โปรเจกต์ของคุณ Mount ที่เก็บโค้ดของคุณที่นี่

### SSH Keys

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

การเข้าถึงแบบอ่านอย่างเดียวสำหรับ SSH keys สำหรับ clone private repositories

### การตั้งค่า Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

รับค่า Git user identity จากโฮสต์

### การตั้งค่า OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

คงการตั้งค่า OpenCode ไว้ระหว่างการรีสตาร์ทคอนเทนเนอร์

### แคช

```bash
-v opencode_cache:/home/opencode/.cache
```

แคชแพ็คเกจ npm, language servers และเครื่องมืออื่นๆ ที่ดาวน์โหลด

## พอร์ต

| พอร์ต  | โปรโตคอล | คำอธิบาย                          |
| ------ | -------- | --------------------------------- |
| `3000` | HTTP     | API เซิร์ฟเวอร์หลัก (ค่าเริ่มต้น) |

พอร์ตสามารถ remap ได้ผ่าน Docker `-p` flag:

```bash
-p 8080:3000  # เข้าถึงเซิร์ฟเวอร์ที่ http://localhost:8080
```

## ผู้ใช้และสิทธิ์

คอนเทนเนอร์ทำงานเป็นผู้ใช้ที่ไม่ใช่ root (`opencode`, UID 1000) เพื่อความปลอดภัย ผู้ใช้นี้มีสิทธิ์ `sudo` โดยไม่ต้องใช้รหัสผ่านสำหรับงานบริหาร:

```bash
# รันคำสั่งเป็นผู้ใช้ opencode
docker exec -it opencode-server sudo -u opencode <command>

# เข้าถึง shell เป็นผู้ใช้ opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

หากคุณต้องการสิทธิ์ root:

```bash
docker exec -it opencode-server /bin/bash
```

## เครื่องมือที่ติดตั้ง

อิมเมจมีเครื่องมือเหล่านี้ติดตั้งไว้แล้ว:

| เครื่องมือ        | คำอธิบาย                                       |
| ----------------- | ---------------------------------------------- |
| `opencode`        | OpenCode CLI                                   |
| `bun`             | JavaScript runtime และ package manager         |
| `bunx`            | ตัวเทียบเท่ากับ npx ของ Bun (รัน npm packages) |
| `uv`              | Python package manager                         |
| `git`             | การควบคุมเวอร์ชัน                              |
| `git-lfs`         | ส่วนขยาย large file storage สำหรับ Git         |
| `build-essential` | GCC, make และ build libraries                  |
| `curl`            | HTTP client                                    |
| `wget`            | ยูทิลิตี้ดาวน์โหลดไฟล์                         |
| `openssh-client`  | SSH client และเครื่องมือ key                   |
| `xz-utils`        | ยูทิลิตี้การบีบอัด                             |

### การใช้ bun

```bash
# รัน Node.js package
docker exec -it opencode-server bunx create-next-app

# ติดตั้ง dependencies
docker exec -it opencode-server bun install
```

### การใช้ uv

```bash
# ติดตั้ง Python package
docker exec -it opencode-server uv pip install pandas

# รัน Python script
docker exec -it opencode-server uv run script.py
```

### การใช้ git

```bash
# Clone repository ไปยัง workspace
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## ตรวจสอบสถานะ

คอนเทนเนอร์มี health check ในตัวที่ตรวจสอบว่าเซิร์ฟเวอร์ตอบสนอง:

```bash
# ตรวจสอบสถานะคอนเทนเนอร์
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

health endpoint ส่งคืน HTTP 200 เมื่อสุขภาพดี:

```bash
# ตรวจสอบสถานะด้วยตนเอง
curl -f http://localhost:3000/health
```

การตั้งค่า health check:

- Interval: 30 วินาที
- Timeout: 10 วินาที
- Start period: 10 วินาที
- Retries: 3

## ตัวอย่าง Docker Compose

สร้างไฟล์ `docker-compose.yml`:

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

เริ่มต้น stack:

```bash
docker-compose up -d
```

## สร้างจาก Source

เพื่อสร้างอิมเมจเซิร์ฟเวอร์จาก source:

### Clone repository

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### สร้างตัวแปร Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### สร้างตัวแปร Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### รัน build ในเครื่อง

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## การแก้ไขปัญหา

### เซิร์ฟเวอร์ไม่เริ่มทำงาน

ตรวจสอบ logs:

```bash
docker logs opencode-server
```

ปัญหาที่พบบ่อย:

- ขาด `OPENCODE_SERVER_PASSWORD` - เซิร์ฟเวอร์ปฏิเสธที่จะเริ่มทำงานโดยไม่มีการยืนยันตัวตน
- พอร์ตถูกใช้งานอยู่ - เปลี่ยนการ map พอร์ตของโฮสต์

### การยืนยันตัวตนล้มเหลว

ตรวจสอบว่ารหัสผ่านตรงกัน เซิร์ฟเวอร์ใช้ HTTP Basic Auth:

```bash
# ทดสอบการยืนยันตัวตน
curl -u opencode:your_password http://localhost:3000/health
```

### ข้อผิดพลาดสิทธิ์ Workspace

ตรวจสอบว่าไดเรกทอรีที่ mount สามารถเขียนได้โดย UID 1000:

```bash
# แก้ไข ownership
sudo chown -R 1000:1000 /path/to/workspace
```

### เริ่มต้นช้า

การรันครั้งแรกจะดาวน์โหลด language servers และเครื่องมือ ตรวจสอบความคืบหน้า:

```bash
docker logs -f opencode-server
```

### คอนเทนเนอร์เข้าถึงอินเทอร์เน็ตไม่ได้

ตรวจสอบการตั้งค่า DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Health check ล้มเหลว

ตรวจสอบว่าเซิร์ฟเวอร์ทำงานจริง:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH key ไม่ทำงาน

ตรวจสอบสิทธิ์ key ที่ถูกต้องภายในคอนเทนเนอร์:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
