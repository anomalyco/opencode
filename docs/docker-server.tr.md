# OpenCode Server Docker Dokümantasyonu

Bu kılavuz, Docker container'larında sunucu modunda OpenCode çalıştırmayı kapsar.

## Giriş

OpenCode Server, arka planda çalışan ve HTTP API üzerinden erişilebilen OpenCode'un headless dağıtımıd. Docker imajı, önceden yüklenmiş tüm gerekli araçlarla birlikte eksiksiz bir çalışma zamanı ortamı sağlar ve şunlar için idealdir:

- Uzaktan geliştirme ortamları
- CI/CD entegrasyonı
- Takım paylaşımlı kodlama örnekleri
- GUI olmayan sunucularda OpenCode çalıştırma

## Hızlı Başlangıç

Güvenli bir şifre ile OpenCode Server'ı çalıştırın:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Sunucuya `http://localhost:3000` adresinden erişin.

## İmaj Çeşitleri

İki temel imaj çeşidi mevcuttur:

| Çeşit    | Temel İmaj         | Boyut  | Kullanım Durumu                      |
| -------- | ------------------ | ------ | ------------------------------------ |
| `debian` | Debian Trixie Slim | ~500MB | Çoğu kullanıcı için önerilir         |
| `alpine` | Alpine Edge        | ~200MB | Minimum ayak izi, daha hızlı indirme |

### Belirli Çeşitleri İndirme

```bash
# Debian (önerilen)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimum)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Ortam Değişkenleri

| Değişken                   | Varsayılan                    | Açıklama                                       |
| -------------------------- | ----------------------------- | ---------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (yok)                         | **Gerekli.** HTTP Basic authentication şifresi |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | HTTP Basic authentication kullanıcı adı        |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Yapılandırma dizini                            |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Önbellek dizini                                |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Veri dizini                                    |

### Sunucu Seçenekleri (CLI Bayrakları)

Sunucu, varsayılan komutu geçersiz kılarken bu ek seçenekleri kabul eder:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Bayrak          | Varsayılan       | Açıklama                        |
| --------------- | ---------------- | ------------------------------- |
| `--port`        | `0` (rastgele)   | Dinlenecek port                 |
| `--hostname`    | `127.0.0.1`      | Bağlanacak host adı             |
| `--mdns`        | `false`          | mDNS hizmet keşfini etkinleştir |
| `--mdns-domain` | `opencode.local` | Özel mDNS domain adı            |
| `--cors`        | `[]`             | İzin verilen ek CORS domainları |

## Volume Mounting

Verileri kalıcı kılmak ve kaynakları paylaşmak için bu volume'ları mount edin:

### Workspace (Gerekli)

```bash
-v /path/to/workspace:/workspace
```

OpenCode'un proje dosyalarınız üzerinde çalıştığı yerdir. Kod deponuzu buraya mount edin.

### SSH Anahtarları

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Özel repository'leri klonlamak için SSH anahtarlarına salt okunur erişim.

### Git Yapılandırması

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Git kullanıcı kimliğini host'tan devral.

### OpenCode Yapılandırması

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Container yeniden başlatmaları arasında OpenCode ayarlarını kalıcı kıl.

### Önbellek

```bash
-v opencode_cache:/home/opencode/.cache
```

npm paketleri, language server'ları ve diğer indirilen araçları önbelleğe al.

## Portlar

| Port   | Protokol | Açıklama                    |
| ------ | -------- | --------------------------- |
| `3000` | HTTP     | Ana sunucu API (varsayılan) |

Port, Docker `-p` bayrağı ile yeniden eşlenebilir:

```bash
-p 8080:3000  # Sunucuya http://localhost:8080 adresinden eriş
```

## Kullanıcı ve İzinler

Container, güvenlik için root olmayan bir kullanıcı (`opencode`, UID 1000) olarak çalışır. Bu kullanıcının yönetim görevleri için şifresiz `sudo` erişimi vardır:

```bash
# opencode kullanıcısı olarak komut çalıştır
docker exec -it opencode-server sudo -u opencode <command>

# opencode kullanıcısı olarak shell al
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Root erişimine ihtiyacınız varsa:

```bash
docker exec -it opencode-server /bin/bash
```

## Yüklü Araçlar

İmaj, kutudan çıktığı gibi şu araçları içerir:

| Araç              | Açıklama                                      |
| ----------------- | --------------------------------------------- |
| `opencode`        | OpenCode CLI                                  |
| `bun`             | JavaScript runtime ve package manager         |
| `bunx`            | Bun'un npx karşılığı (npm paketleri çalıştır) |
| `uv`              | Python package manager                        |
| `git`             | Sürüm kontrolü                                |
| `git-lfs`         | Git için büyük dosya depolama uzantısı        |
| `build-essential` | GCC, make ve build kütüphaneleri              |
| `curl`            | HTTP istemcisi                                |
| `wget`            | Dosya indirme yardımcı programı               |
| `openssh-client`  | SSH istemcisi ve anahtar araçları             |
| `xz-utils`        | Sıkıştırma yardımcı programları               |

### bun Kullanımı

```bash
# Node.js paketi çalıştır
docker exec -it opencode-server bunx create-next-app

# Bağımlılıkları yükle
docker exec -it opencode-server bun install
```

### uv Kullanımı

```bash
# Python paketi yükle
docker exec -it opencode-server uv pip install pandas

# Python scripti çalıştır
docker exec -it opencode-server uv run script.py
```

### git Kullanımı

```bash
# Repository'yi workspace'e klonla
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Sağlık Kontrolü

Container, sunucunun yanıt verdiğini doğrulayan yerleşik bir sağlık kontrolü içerir:

```bash
# Container sağlığını kontrol et
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Sağlık endpoint'i sağlıklı olduğunda HTTP 200 döndürür:

```bash
# Manuel sağlık kontrolü
curl -f http://localhost:3000/health
```

Sağlık kontrolü yapılandırması:

- Aralık: 30 saniye
- Zaman aşımı: 10 saniye
- Başlangıç süresi: 10 saniye
- Deneme sayısı: 3

## Docker Compose Örneği

Bir `docker-compose.yml` dosyası oluşturun:

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

Stack'i başlatın:

```bash
docker-compose up -d
```

## Kaynaktan Derleme

Sunucu imajını kaynaktan derlemek için:

### Repository'yi klonla

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Debian çeşidini derle

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Alpine çeşidini derle

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Yerel derlemenizi çalıştırın

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Sorun Giderme

### Sunucu başlamıyor

Logları kontrol edin:

```bash
docker logs opencode-server
```

Yaygın sorunlar:

- `OPENCODE_SERVER_PASSWORD` eksik - sunucu kimlik doğrulama olmadan başlamayı reddeder
- Port zaten kullanımda - host port eşlemesini değiştirin

### Kimlik doğrulama başarısız

Şifrenin tam olarak eşleştiğinden emin olun. Sunucu HTTP Basic Auth kullanır:

```bash
# Kimlik doğrulamayı test et
curl -u opencode:your_password http://localhost:3000/health
```

### Workspace izin hataları

Mount edilen dizinin UID 1000 tarafından yazılabilir olduğundan emin olun:

```bash
# Sahipliği düzelt
sudo chown -R 1000:1000 /path/to/workspace
```

### Yavaş başlangıç

İlk çalıştırma language server'ları ve araçları indirir. İlerlemeyi kontrol edin:

```bash
docker logs -f opencode-server
```

### Container internete erişemiyor

DNS yapılandırmasını kontrol edin:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Sağlık kontrolü başarısız

Sunucunun gerçekten çalıştığını doğrulayın:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH anahtarı çalışmıyor

Container içinde doğru anahtar izinlerini sağlayın:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
