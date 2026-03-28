# OpenCode সার্ভার ডকার ডকুমেন্টেশন

এই নির্দেশিকাটি ডকার কন্টেইনারের মধ্যে সার্ভার মোডে OpenCode চালানোর বিষয়ে।

## ভূমিকা

OpenCode সার্ভার হলো OpenCode-এর একটি হেডলেস ডিপ্লয়মেন্ট যা ব্যাকগ্রাউন্ড সার্ভিস হিসাবে চলে এবং HTTP API-এর মাধ্যমে অ্যাক্সেসযোগ্য। ডকার ইমেজ একটি সম্পূর্ণ রানটাইম এনভায়রনমেন্ট প্রদান করে যেখানে সমস্ত প্রয়োজনীয় টুল প্রি-ইনস্টল করা থাকে, যা এটিকে নিম্নলিখিত কাজের জন্য আদর্শ করে তোলে:

- রিমোট ডেভেলপমেন্ট এনভায়রনমেন্ট
- CI/CD ইন্টিগ্রেশন
- টিম শেয়ার্ড কোডিং ইনস্ট্যান্স
- GUI ছাড়া সার্ভারে OpenCode চালানো

## দ্রুত শুরু

একটি সুরক্ষিত পাসওয়ার্ড দিয়ে OpenCode সার্ভার চালান:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

`http://localhost:3000` এ সার্ভারে অ্যাক্সেস করুন।

## ইমেজ ভেরিয়েন্ট

দুটি বেস ইমেজ ভেরিয়েন্ট পাওয়া যায়:

| ভেরিয়েন্ট | বেস ইমেজ           | সাইজ   | ব্যবহারের ক্ষেত্র                     |
| ---------- | ------------------ | ------ | ------------------------------------- |
| `debian`   | Debian Trixie Slim | ~500MB | বেশিরভাগ ব্যবহারকারীর জন্য সুপারিশকৃত |
| `alpine`   | Alpine Edge        | ~200MB | সর্বনিম্ন ফুটপ্রিন্ট, দ্রুত পুল       |

### নির্দিষ্ট ভেরিয়েন্ট পুল করা

```bash
# Debian (সুপারিশকৃত)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (সর্বনিম্ন)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## এনভায়রনমেন্ট ভেরিয়েবল

| ভেরিয়েবল                  | ডিফল্ট                        | বর্ণনা                                                        |
| -------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (কোনোটিই নয়)                 | **প্রয়োজনীয়।** HTTP Basic authentication-এর জন্য পাসওয়ার্ড |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | HTTP Basic authentication-এর জন্য ব্যবহারকারী নাম             |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | কনফিগারেশন ডিরেক্টরি                                          |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | ক্যাশ ডিরেক্টরি                                               |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | ডেটা ডিরেক্টরি                                                |

### সার্ভার অপশন (CLI ফ্ল্যাগ)

ডিফল্ট কমান্ড ওভাররাইড করার সময় সার্ভার এই অতিরিক্ত অপশনগুলি গ্রহণ করে:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| ফ্ল্যাগ         | ডিফল্ট           | বর্ণনা                             |
| --------------- | ---------------- | ---------------------------------- |
| `--port`        | `0` (র‍্যান্ডম)  | শোনার জন্য পোর্ট                   |
| `--hostname`    | `127.0.0.1`      | বাইন্ড করার জন্য হোস্টনেম          |
| `--mdns`        | `false`          | mDNS সার্ভিস ডিসকভারি সক্রিয় করুন |
| `--mdns-domain` | `opencode.local` | কাস্টম mDNS ডোমেইন নাম             |
| `--cors`        | `[]`             | অতিরিক্ত CORS-অনুমোদিত ডোমেইন      |

## ভলিউম মাউন্ট

ডেটা সংরক্ষণ এবং রিসোর্স শেয়ার করতে এই ভলিউমগুলি মাউন্ট করুন:

### ওয়ার্কস্পেস (প্রয়োজনীয়)

```bash
-v /path/to/workspace:/workspace
```

এখানে OpenCode আপনার প্রজেক্ট ফাইলগুলির সাথে কাজ করে। আপনার কোড রিপোজিটরি এখানে মাউন্ট করুন।

### SSH কী

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

প্রাইভেট রিপোজিটরি ক্লোন করার জন্য SSH কী-এর শুধুমাত্র পড়ার অ্যাক্সেস।

### গিট কনফিগারেশন

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

হোস্ট থেকে গিট ব্যবহারকারী পরিচয় ইনহেরিট করুন।

### OpenCode কনফিগারেশন

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

কন্টেইনার রিস্টার্টের মধ্যে OpenCode সেটিংস সংরক্ষণ করুন।

### ক্যাশ

```bash
-v opencode_cache:/home/opencode/.cache
```

npm প্যাকেজ, ল্যাংগুয়েজ সার্ভার এবং অন্যান্য ডাউনলোড করা টুল ক্যাশ করুন।

## পোর্ট

| পোর্ট  | প্রোটোকল | বর্ণনা                   |
| ------ | -------- | ------------------------ |
| `3000` | HTTP     | মূল সার্ভার API (ডিফল্ট) |

Docker-এর `-p` ফ্ল্যাগের মাধ্যমে পোর্ট পুনরায় ম্যাপ করা যায়:

```bash
-p 8080:3000  # http://localhost:8080 এ সার্ভার অ্যাক্সেস করুন
```

## ব্যবহারকারী এবং অনুমতি

নিরাপত্তার জন্য কন্টেইনারটি একটি নন-রুট ব্যবহারকারী (`opencode`, UID 1000) হিসাবে চলে। এই ব্যবহারকারীর প্রশাসনিক কাজের জন্য পাসওয়ার্ড ছাড়া `sudo` অ্যাক্সেস আছে:

```bash
# opencode ব্যবহারকারী হিসাবে কমান্ড এক্সিকিউট করুন
docker exec -it opencode-server sudo -u opencode <command>

# opencode ব্যবহারকারী হিসাবে শেল পান
docker exec -it opencode-server sudo -u opencode /bin/bash
```

আপনার রুট অ্যাক্সেস দরকার হলে:

```bash
docker exec -it opencode-server /bin/bash
```

## ইনস্টল করা টুল

ইমেজে এই টুলগুলি অন্তর্ভুক্ত রয়েছে:

| টুল               | বর্ণনা                                    |
| ----------------- | ----------------------------------------- |
| `opencode`        | OpenCode CLI                              |
| `bun`             | JavaScript রানটাইম এবং প্যাকেজ ম্যানেজার  |
| `bunx`            | bun-এর npx-এর সমতুল্য (npm প্যাকেজ চালান) |
| `uv`              | Python প্যাকেজ ম্যানেজার                  |
| `git`             | ভার্সন কন্ট্রোল                           |
| `git-lfs`         | Git-এর জন্য বড় ফাইল স্টোরেজ এক্সটেনশন    |
| `build-essential` | GCC, make এবং বিল্ড লাইব্রেরি             |
| `curl`            | HTTP ক্লায়েন্ট                           |
| `wget`            | ফাইল ডাউনলোড ইউটিলিটি                     |
| `openssh-client`  | SSH ক্লায়েন্ট এবং কী টুল                 |
| `xz-utils`        | কম্প্রেশন ইউটিলিটি                        |

### bun ব্যবহার করা

```bash
# একটি Node.js প্যাকেজ চালান
docker exec -it opencode-server bunx create-next-app

# ডিপেন্ডেন্সি ইনস্টল করুন
docker exec -it opencode-server bun install
```

### uv ব্যবহার করা

```bash
# একটি Python প্যাকেজ ইনস্টল করুন
docker exec -it opencode-server uv pip install pandas

# একটি Python স্ক্রিপ্ট চালান
docker exec -it opencode-server uv run script.py
```

### git ব্যবহার করা

```bash
# রিপোজিটরি ওয়ার্কস্পেসে ক্লোন করুন
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## হেলথ চেক

কন্টেইনারে একটি বিল্ট-ইন হেলথ চেক অন্তর্ভুক্ত যা সার্ভার প্রতিক্রিয়া দিচ্ছে কিনা তা যাচাই করে:

```bash
# কন্টেইনারের স্বাস্থ্য পরীক্ষা করুন
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

স্বাস্থ্যমান হলে হেলথ এন্ডপয়েন্ট HTTP 200 রিটার্ন করে:

```bash
# ম্যানুয়াল হেলথ চেক
curl -f http://localhost:3000/health
```

হেলথ চেক কনফিগারেশন:

- ইন্টারভ্যাল: 30 সেকেন্ড
- টাইমআউট: 10 সেকেন্ড
- স্টার্ট পিরিয়ড: 10 সেকেন্ড
- রিট্রাই: 3

## Docker Compose উদাহরণ

একটি `docker-compose.yml` ফাইল তৈরি করুন:

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

স্টার্ট চালান:

```bash
docker-compose up -d
```

## সোর্স থেকে বিল্ড

সোর্স থেকে সার্ভার ইমেজ বিল্ড করতে:

### রিপোজিটরি ক্লোন করুন

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Debian ভেরিয়েন্ট বিল্ড

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Alpine ভেরিয়েন্ট বিল্ড

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### আপনার লোকাল বিল্ড চালান

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## সমস্যা সমাধান

### সার্ভার শুরু হচ্ছে না

লগ পরীক্ষা করুন:

```bash
docker logs opencode-server
```

সাধারণ সমস্যা:

- `OPENCODE_SERVER_PASSWORD` অনুপস্থিত - সার্ভার প্রমাণীকরণ ছাড়া শুরু হতে অস্বীকার করে
- পোর্ট ইতিমধ্যে ব্যবহৃত - হোস্ট পোর্ট ম্যাপিং পরিবর্তন করুন

### প্রমাণীকরণ ব্যর্থ হচ্ছে

পাসওয়ার্ড সঠিক মিলছে তা নিশ্চিত করুন। সার্ভার HTTP Basic Auth ব্যবহার করে:

```bash
# প্রমাণীকরণ পরীক্ষা করুন
curl -u opencode:your_password http://localhost:3000/health
```

### ওয়ার্কস্পেস পারমিশন ত্রুটি

মাউন্ট করা ডিরেক্টরি UID 1000 দ্বারা লেখার যোগ্য তা নিশ্চিত করুন:

```bash
# মালিকানা ঠিক করুন
sudo chown -R 1000:1000 /path/to/workspace
```

### ধীর স্টার্টআপ

প্রথম রানে ল্যাংগুয়েজ সার্ভার এবং টুল ডাউনলোড হয়। অগ্রগতি পরীক্ষা করুন:

```bash
docker logs -f opencode-server
```

### কন্টেইনার ইন্টারনেটে পৌঁছাতে পারছে না

DNS কনফিগারেশন পরীক্ষা করুন:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### হেলথ চেক ব্যর্থ হচ্ছে

সার্ভার আসলে চলছে তা যাচাই করুন:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH কী কাজ করছে না

কন্টেইনারের মধ্যে সঠিক কী পারমিশন নিশ্চিত করুন:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
