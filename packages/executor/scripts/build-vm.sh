#!/usr/bin/env bash
set -euo pipefail

# Build script for Firecracker VM image with Python and Univer SDK
# This creates a minimal Ubuntu-based root filesystem

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/../build"
OUTPUT_DIR="${SCRIPT_DIR}/../output"
ROOTFS_SIZE="${ROOTFS_SIZE:-2048}"  # MB
UBUNTU_VERSION="${UBUNTU_VERSION:-jammy}"

echo "Building Firecracker VM image..."
echo "Build dir: ${BUILD_DIR}"
echo "Output dir: ${OUTPUT_DIR}"

mkdir -p "${BUILD_DIR}" "${OUTPUT_DIR}"

# Step 1: Create empty disk image
echo "Creating root filesystem image..."
ROOTFS_IMG="${OUTPUT_DIR}/rootfs.ext4"
dd if=/dev/zero of="${ROOTFS_IMG}" bs=1M count="${ROOTFS_SIZE}"
mkfs.ext4 "${ROOTFS_IMG}"

# Step 2: Mount and install Ubuntu base
echo "Installing Ubuntu base system..."
MOUNT_DIR="${BUILD_DIR}/rootfs"
mkdir -p "${MOUNT_DIR}"

sudo mount "${ROOTFS_IMG}" "${MOUNT_DIR}"

# Install debootstrap if not present
if ! command -v debootstrap &> /dev/null; then
    echo "Installing debootstrap..."
    sudo apt-get update && sudo apt-get install -y debootstrap
fi

# Bootstrap Ubuntu
sudo debootstrap --arch=amd64 "${UBUNTU_VERSION}" "${MOUNT_DIR}" http://archive.ubuntu.com/ubuntu/

# Step 3: Configure the system
echo "Configuring system..."

# Set up networking
cat <<EOF | sudo tee "${MOUNT_DIR}/etc/systemd/network/eth0.network"
[Match]
Name=eth0

[Network]
DHCP=yes
EOF

# Set root password
sudo chroot "${MOUNT_DIR}" /bin/bash -c "echo 'root:root' | chpasswd"

# Install essential packages
echo "Installing packages..."
sudo chroot "${MOUNT_DIR}" /bin/bash -c "
    apt-get update
    apt-get install -y \
        openssh-server \
        python3 \
        python3-pip \
        python3-venv \
        curl \
        wget \
        git \
        vim \
        nano \
        ca-certificates \
        systemd \
        systemd-sysv \
        iproute2 \
        iputils-ping
"

# Step 4: Install Univer SDK
echo "Installing Univer SDK..."

# Copy Univer SDK Python module
UNIVER_SDK_SRC="${SCRIPT_DIR}/../../univer-sdk/python"
if [ -d "${UNIVER_SDK_SRC}" ]; then
    sudo mkdir -p "${MOUNT_DIR}/opt/univer-sdk"
    sudo cp -r "${UNIVER_SDK_SRC}"/* "${MOUNT_DIR}/opt/univer-sdk/"
    
    # Install in the chroot
    sudo chroot "${MOUNT_DIR}" /bin/bash -c "
        python3 -m pip install -U pip setuptools wheel --break-system-packages || python3 -m pip install -U pip setuptools wheel
        cd /opt/univer-sdk &&
        python3 -m pip install -e . --break-system-packages || python3 -m pip install -e .
        python3 -m pip show veritly-univer-sdk || python3 -m pip show veritly_univer_sdk
        python3 -c 'from veritly_univer_sdk import UniverSDK; print(\"Univer SDK ready\")'
    "
fi

# Step 5: Configure SSH
echo "Configuring SSH..."
sudo mkdir -p "${MOUNT_DIR}/root/.ssh"
sudo chmod 700 "${MOUNT_DIR}/root/.ssh"

# Generate or copy SSH host keys
if [ -f "${SCRIPT_DIR}/ssh_host_rsa_key" ]; then
    sudo cp "${SCRIPT_DIR}/ssh_host_rsa_key" "${MOUNT_DIR}/etc/ssh/"
    sudo cp "${SCRIPT_DIR}/ssh_host_rsa_key.pub" "${MOUNT_DIR}/etc/ssh/"
else
    sudo chroot "${MOUNT_DIR}" /bin/bash -c "ssh-keygen -A"
fi

# Configure SSH to allow root login with key
sudo sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' "${MOUNT_DIR}/etc/ssh/sshd_config"
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' "${MOUNT_DIR}/etc/ssh/sshd_config"

# Step 6: Create workspace directory
echo "Setting up workspace..."
sudo mkdir -p "${MOUNT_DIR}/workspace"
sudo chmod 777 "${MOUNT_DIR}/workspace"

# Step 7: Add startup script
echo "Creating startup script..."
cat <<'EOF' | sudo tee "${MOUNT_DIR}/usr/local/bin/start-vm.sh"
#!/bin/bash
# VM startup script

echo "Starting Veritly Executor VM..."

# Start SSH
echo "Starting SSH daemon..."
/etc/init.d/ssh start || service ssh start

# Keep the VM alive
echo "VM is ready. Waiting for commands..."
while true; do
    sleep 60
    # Check if SSH is still running
    if ! pgrep -x "sshd" > /dev/null; then
        echo "SSH died, restarting..."
        /etc/init.d/ssh start || service ssh start
    fi
done
EOF

sudo chmod +x "${MOUNT_DIR}/usr/local/bin/start-vm.sh"

# Step 8: Set up init
echo "Configuring init..."
cat <<EOF | sudo tee "${MOUNT_DIR}/etc/init.d/veritly-vm"
#!/bin/bash
### BEGIN INIT INFO
# Provides:          veritly-vm
# Required-Start:    \$remote_fs \$syslog
# Required-Stop:     \$remote_fs \$syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Start Veritly VM services
### END INIT INFO

case "\$1" in
    start)
        echo "Starting Veritly VM..."
        /usr/local/bin/start-vm.sh &
        ;;
    stop)
        echo "Stopping Veritly VM..."
        pkill -f start-vm.sh || true
        ;;
    *)
        echo "Usage: \$0 {start|stop}"
        exit 1
        ;;
esac
EOF

sudo chmod +x "${MOUNT_DIR}/etc/init.d/veritly-vm"
sudo chroot "${MOUNT_DIR}" /bin/bash -c "update-rc.d veritly-vm defaults"

# Step 9: Clean up
echo "Cleaning up..."
sudo rm -rf "${MOUNT_DIR}/var/cache/apt/archives/*"
sudo rm -rf "${MOUNT_DIR}/var/lib/apt/lists/*"

# Unmount
sudo umount "${MOUNT_DIR}"

# Step 10: Download kernel if not present
echo "Checking for kernel..."
KERNEL_URL="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/v1.8/x86_64/vmlinux-5.10.186"
KERNEL_OUTPUT="${OUTPUT_DIR}/vmlinux"

if [ ! -f "${KERNEL_OUTPUT}" ]; then
    echo "Downloading Firecracker kernel..."
    curl -L -o "${KERNEL_OUTPUT}" "${KERNEL_URL}"
    chmod +x "${KERNEL_OUTPUT}"
fi

# Done
echo ""
echo "Build complete!"
echo ""
echo "Output files:"
echo "  Rootfs: ${ROOTFS_IMG}"
echo "  Kernel: ${KERNEL_OUTPUT}"
echo ""
echo "To use these with the executor, set these environment variables:"
echo "  export KERNEL_PATH=${KERNEL_OUTPUT}"
echo "  export ROOTFS_PATH=${ROOTFS_IMG}"
echo ""

# Cleanup build directory
sudo rm -rf "${BUILD_DIR}"
