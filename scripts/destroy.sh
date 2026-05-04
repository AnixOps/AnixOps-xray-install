#!/bin/bash
# VPS Destroy & Cleanup Script
# Usage: ./destroy.sh
# Should be called before VPS deletion to clean up any traces

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }

log_info "Stopping services..."
systemctl stop hysteria-server 2>/dev/null || true
systemctl stop xray 2>/dev/null || true
systemctl disable hysteria-server 2>/dev/null || true
systemctl disable xray 2>/dev/null || true

log_info "Removing data..."
rm -rf /usr/local/bin/hysteria
rm -rf /usr/local/xray
rm -rf /usr/local/etc/xray
rm -rf /etc/hysteria
rm -f /etc/systemd/system/hysteria-server.service
rm -f /etc/systemd/system/xray.service

log_info "Clearing logs..."
rm -rf /var/log/xray
journalctl --vacuum-size=1M 2>/dev/null || true

log_info "Clearing bash history..."
history -c 2>/dev/null || true
cat /dev/null > ~/.bash_history 2>/dev/null || true
rm -f ~/.bash_history 2>/dev/null || true

# Only remove AnixOps-specific SSH keys (keys with "anixops" comment)
if [[ -f ~/.ssh/authorized_keys ]]; then
  grep -v "anixops" ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp 2>/dev/null || true
  mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys 2>/dev/null || true
fi

log_info "Removing sysctl tuning..."
rm -f /etc/sysctl.d/99-hysteria.conf 2>/dev/null || true

log_info "Cleanup complete. VPS is now safe to destroy."
