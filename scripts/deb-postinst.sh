#!/bin/bash
# postinst — configure-time maintainer script for opencode-server.service
# Policy: REQ-004A — auto enable + start on fresh install.
set -e

UNIT_NAME="opencode-server.service"
# REQ-004A: AUTO_ENABLE=1 means fresh install enables and starts the service.
# Set AUTO_ENABLE=0 and reconfigure for manual opt-in (REQ-004B).
AUTO_ENABLE=1

case "$1" in
  configure)
    # Create mxadm user/group if they don't exist
    if ! getent group mxadm >/dev/null 2>&1; then
      groupadd --system mxadm
    fi
    if ! getent passwd mxadm >/dev/null 2>&1; then
      useradd --system --gid mxadm --home-dir /home/mxadm \
        --shell /usr/sbin/nologin --no-create-home mxadm
    fi

    # Ensure config directory exists with correct ownership
    install -d -m 0755 -o mxadm -g mxadm /home/mxadm/.opencode
    install -d -m 0755 -o mxadm -g mxadm /home/mxadm/.config/opencode

    # Gate all systemctl activity on a running systemd.  On non-systemd hosts
    # (docker, chroot, SysV) every systemctl call would either fail or hang
    # waiting for an init that will never come; exit cleanly instead.
    if [ ! -d /run/systemd/system ] || ! command -v systemctl >/dev/null 2>&1; then
      echo "WARNING: systemd not running — skipping service enable/start."
      exit 0
    fi

    # Dual-path verify: the unit may live under /lib (vendor) or /etc (admin
    # override).  Check both before acting so DEB-03's path choice is
    # order-independent of this script.
    UNIT_LIB="/usr/lib/systemd/system/${UNIT_NAME}"
    UNIT_ETC="/etc/systemd/system/${UNIT_NAME}"
    if [ ! -f "$UNIT_LIB" ] && [ ! -f "$UNIT_ETC" ]; then
      echo "ERROR: ${UNIT_NAME} not found in ${UNIT_LIB} or ${UNIT_ETC}" >&2
      echo "       The .deb data.tar may be missing the unit. Reinstall the package." >&2
      exit 1
    fi

    # Verify wrapper is present and executable (data.tar contract)
    if [ ! -x /usr/local/bin/opencode-env.sh ]; then
      echo "ERROR: /usr/local/bin/opencode-env.sh missing or not executable." >&2
      echo "       The .deb data.tar may be corrupt. Reinstall the package." >&2
      exit 1
    fi

    # Diagnose masked service — never unmask silently
    if systemctl is-enabled --quiet "${UNIT_NAME}" 2>/dev/null && \
       systemctl is-enabled "${UNIT_NAME}" 2>&1 | grep -q "masked"; then
      echo "WARNING: ${UNIT_NAME} is masked. Will not unmask automatically." >&2
      echo "  To unmask: sudo systemctl unmask ${UNIT_NAME}" >&2
      echo "  Then reconfigure: sudo dpkg --configure opencode" >&2
      exit 0
    fi

    # Always daemon-reload so systemd picks up the unit after install/upgrade
    systemctl daemon-reload

    if [ "${AUTO_ENABLE}" -eq 1 ]; then
      # REQ-004A: auto enable + start
      systemctl enable --now "${UNIT_NAME}"
      echo
      echo "opencode-server.service is enabled and started."
      echo "  Status:  systemctl status ${UNIT_NAME}"
      echo "  Logs:    journalctl -u ${UNIT_NAME} -f"
      echo "  Stop:    sudo systemctl stop ${UNIT_NAME}"
      echo "  Disable: sudo systemctl disable ${UNIT_NAME}"
      echo
    else
      # REQ-004B: manual opt-in
      echo
      echo "opencode-server.service installed. Enable and start when ready:"
      echo "    sudo systemctl enable --now ${UNIT_NAME}"
      echo
    fi

    # Warn about conflict with old opencode.service (guarded — only when systemd
    # is actually running; the block at :30 was previously unguarded and broke
    # non-systemd installs).
    if systemctl is-enabled --quiet opencode.service 2>/dev/null; then
      echo "NOTE: old opencode.service is still enabled; it binds the same port."
      echo "Disable it first:"
      echo "    sudo systemctl disable --now opencode.service"
      echo
    fi
    ;;
esac

exit 0
