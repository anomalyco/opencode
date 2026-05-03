#!/usr/bin/env bash
set -euo pipefail

# Builds minimal Alpine Linux guest roots + vmlinuz (+ initrd when present) per arch.
# Requires Docker (buildx for cross-arch). Output:
#   packages/executor/output/aarch64/{guest-root,vmlinuz,initrd.img?}
#   packages/executor/output/x86_64/{guest-root,vmlinuz,initrd.img?}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXEC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$EXEC_DIR/../.." && pwd)"
OUT="$EXEC_DIR/output"
SDK_PY="$REPO_ROOT/packages/univer-sdk/python"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build guest images" >&2
  exit 1
fi
if [ ! -d "$SDK_PY" ]; then
  echo "missing Univer SDK python path: $SDK_PY" >&2
  exit 1
fi

mkdir -p "$OUT/aarch64" "$OUT/x86_64"

inner() {
  cat <<'INNER'
set -eux
OUT=/out
ST=/tmp/staging
rm -rf "$ST" "$OUT/guest-root"
apk add --no-cache rsync

mkdir -p "$ST/etc/apk/keys"
cp -a /etc/apk/keys/. "$ST/etc/apk/keys/"
echo "https://dl-cdn.alpinelinux.org/alpine/v3.20/main" > "$ST/etc/apk/repositories"
echo "https://dl-cdn.alpinelinux.org/alpine/v3.20/community" >> "$ST/etc/apk/repositories"

apk add --root "$ST" --initdb -U alpine-baselayout busybox ssl_client ca-certificates
apk add --root "$ST" --no-cache \
  openssh linux-virt busybox-extras iproute2 \
  python3 py3-pip py3-websockets

mkdir -p "$ST/tmp/sdk"
cp -a /sdk-py/. "$ST/tmp/sdk/"
mkdir -p "$ST/proc" "$ST/sys" "$ST/dev"
mount --bind /proc "$ST/proc"
mount --bind /sys "$ST/sys"
mount --bind /dev "$ST/dev"
chroot "$ST" /usr/bin/python3 -m pip install --no-cache-dir --no-build-isolation --no-deps --break-system-packages /tmp/sdk
echo 'root:root' | chroot "$ST" /usr/sbin/chpasswd
umount "$ST/proc" "$ST/sys" "$ST/dev"
rm -rf "$ST/proc" "$ST/sys" "$ST/dev" "$ST/tmp/sdk"
mkdir -p "$ST/proc" "$ST/sys" "$ST/dev"

sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' "$ST/etc/ssh/sshd_config"
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' "$ST/etc/ssh/sshd_config"

cat > "$ST/sbin/veritly-init" <<'INIT'
#!/bin/sh
export PATH=/sbin:/bin:/usr/sbin:/usr/bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
if ! mount -t devtmpfs devtmpfs /dev 2>/dev/null; then
  mount -t tmpfs tmpfs /dev
  [ -e /dev/null ] || mknod /dev/null c 1 3
  chmod 666 /dev/null
fi
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts 2>/dev/null || mount -t devpts none /dev/pts
ip link set lo up 2>/dev/null || true
ip link set eth0 up 2>/dev/null || true
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  udhcpc -i eth0 -n -q -t 4 -T 2 && break
  sleep 1
done
echo 'nameserver 10.0.2.3' > /etc/resolv.conf 2>/dev/null || true
mkdir -p /run/sshd /workspace
rm -rf /var/empty
mkdir /var/empty
mount -t tmpfs -o size=1m,mode=711,nosuid,noexec tmpfs /var/empty
ssh-keygen -A >/dev/null 2>&1 || true
/usr/sbin/sshd -e
exec sleep infinity
INIT
chmod +x "$ST/sbin/veritly-init"

mkdir -p "$ST/workspace"

# linux-virt default initramfs omits 9p; Alpine init then cannot mount root=veritly9p.
mount --bind /proc "$ST/proc"
mount --bind /sys "$ST/sys"
mount --bind /dev "$ST/dev"
sed -i 's/scsi usb virtio/scsi usb virtio 9p/' "$ST/etc/mkinitfs/mkinitfs.conf"
kver=$(ls -1 "$ST/lib/modules")
chroot "$ST" /sbin/mkinitfs "$kver"
umount "$ST/proc" "$ST/sys" "$ST/dev"

if [ -f "$ST/boot/vmlinuz-virt" ]; then
  cp "$ST/boot/vmlinuz-virt" "$OUT/vmlinuz"
fi
if [ -f "$ST/boot/initramfs-virt" ]; then
  cp "$ST/boot/initramfs-virt" "$OUT/initrd.img"
  chmod 644 "$OUT/initrd.img"
fi

mkdir -p "$OUT/guest-root"
rsync -rlt "$ST/" "$OUT/guest-root/" --exclude boot --no-perms --no-owner --no-group
INNER
}

build_one() {
  local plat=$1
  local name=$2
  echo "=== building guest: $name ($plat) ==="
  docker run --rm --privileged \
    --platform "$plat" \
    -v "$OUT/$name:/out" \
    -v "$SDK_PY:/sdk-py:ro" \
    alpine:3.20 \
    sh -ec "$(inner)"
}

build_one linux/arm64 aarch64
build_one linux/amd64 x86_64

echo "Guest bundles ready under $OUT/{aarch64,x86_64}"
