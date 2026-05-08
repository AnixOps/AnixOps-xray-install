#!/bin/bash
# VLESS+Reality Installation Script (Non-interactive, TCP transport)
# Xray core: https://github.com/XTLS/Xray-core
# Usage: ./vless-reality.sh --uuid UUID --port PORT [--short-id SHORT_ID] [--server-name SNI]

set -euo pipefail

INSTALL_DIR="/usr/local/xray"
CONFIG_DIR="/usr/local/etc/xray"
CONFIG_FILE="${CONFIG_DIR}/config.json"
SERVICE_FILE="/etc/systemd/system/xray.service"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
UUID=""
PORT="443"
SERVER_NAME="addons.mozilla.org"
SHORT_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --uuid)        UUID="$2";        shift 2 ;;
    --port)        PORT="$2";        shift 2 ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --short-id)    SHORT_ID="$2";    shift 2 ;;
    *) shift ;;
  esac
done

# Validate inputs
if [[ -z "$UUID" ]]; then
  log_error "--uuid is required"
  exit 1
fi

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  log_error "Invalid port: $PORT"
  exit 1
fi

if [[ ! "$SERVER_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  log_error "Invalid server name: $SERVER_NAME"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  log_error "Must run as root"
  exit 1
fi

ensure_dependency() {
  local cmd="$1"
  local pkg="${2:-$1}"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi

  log_warn "Missing dependency: $cmd, attempting to install ${pkg}..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y "$pkg"
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y "$pkg"
  elif command -v yum >/dev/null 2>&1; then
    yum install -y "$pkg"
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache "$pkg"
  else
    log_error "No supported package manager found to install ${pkg}"
    exit 1
  fi

  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Failed to install dependency: $cmd"
    exit 1
  fi
}

# Generate short ID if not provided
if [[ -z "$SHORT_ID" ]]; then
  SHORT_ID=$(openssl rand -hex 4)
fi

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
  x86_64)  XRAY_ARCH="linux-64" ;;
  aarch64) XRAY_ARCH="linux-arm64-v8a" ;;
  armv7l)  XRAY_ARCH="linux-arm32-v7a" ;;
  *)       log_error "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Install Xray core
install_xray() {
  log_info "Installing Xray core (${XRAY_ARCH})..."

  local tmpdir
  tmpdir=$(mktemp -d)

  # Use latest release redirect — no jq dependency needed
  curl -fsSL -o "$tmpdir/xray.zip" \
    "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-${XRAY_ARCH}.zip"

  mkdir -p "$INSTALL_DIR"
  unzip -o "$tmpdir/xray.zip" -d "$tmpdir/xray"
  mv "$tmpdir/xray/xray" "$INSTALL_DIR/xray"
  chmod +x "${INSTALL_DIR}/xray"
  ln -sf "${INSTALL_DIR}/xray" /usr/local/bin/xray

  rm -rf "$tmpdir"
  log_info "Xray installed: $(xray version | head -1)"
}

# Generate Reality key pair via Xray
generate_reality_keys() {
  log_info "Generating Reality x25519 keys..."
  local keypair
  keypair=$(xray x25519)
  REALITY_PRIVATE_KEY=$(printf '%s\n' "$keypair" | awk -F': ' '/^(Private key|PrivateKey):/{print $2}')
  REALITY_PUBLIC_KEY=$(printf '%s\n' "$keypair" | awk -F': ' '/^(Public key|Password \(PublicKey\)):/ {print $2}')
  if [[ -z "${REALITY_PRIVATE_KEY:-}" || -z "${REALITY_PUBLIC_KEY:-}" ]]; then
    log_error "Failed to parse Reality keypair output"
    printf '%s\n' "$keypair"
    exit 1
  fi
}

# Generate config
generate_config() {
  generate_reality_keys

  mkdir -p "$CONFIG_DIR"
  mkdir -p /var/log/xray

  cat > "$CONFIG_FILE" <<EOF
{
  "log": {
    "access": "/var/log/xray/access.log",
    "error": "/var/log/xray/error.log",
    "loglevel": "warning"
  },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": ${PORT},
      "protocol": "vless",
      "settings": {
        "clients": [
          {
            "id": "${UUID}",
            "flow": "xtls-rprx-vision"
          }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${SERVER_NAME}:443",
          "xver": 0,
          "serverNames": ["${SERVER_NAME}"],
          "privateKey": "${REALITY_PRIVATE_KEY}",
          "shortIds": ["${SHORT_ID}"]
        }
      },
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls"]
      }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ]
}
EOF

  log_info "Config generated at ${CONFIG_FILE}"
}

# Create systemd service
create_service() {
  # Create unprivileged xray user if not exists
  if ! id -u xray &>/dev/null; then
    useradd -r -s /usr/sbin/nologin -M xray
    log_info "Created xray user"
  fi

  chown -R xray:xray "$INSTALL_DIR"
  chown -R xray:xray "$CONFIG_DIR"
  chown -R xray:xray /var/log/xray

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Xray Service
After=network.target nss-lookup.target

[Service]
Type=simple
User=xray
Group=xray
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ExecStart=${INSTALL_DIR}/xray run -config ${CONFIG_FILE}
Restart=on-failure
RestartSec=5
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable xray
}

# Firewall
open_firewall() {
  log_info "Opening port ${PORT}/tcp..."
  if command -v ufw &>/dev/null; then
    ufw allow "${PORT}/tcp"
    ufw --force enable 2>/dev/null || true
  elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port="${PORT}/tcp"
    firewall-cmd --reload
  else
    log_warn "No firewall tool found, ensure port ${PORT}/tcp is open"
  fi
}

apply_safety_policy() {
  log_info "Applying outbound abuse-port blocks..."
  local tcp_ports="25,465,587,6881:6999,51413"
  local udp_ports="6881:6999,51413"

  if command -v iptables &>/dev/null; then
    iptables -C OUTPUT -p tcp -m multiport --dports "${tcp_ports}" -j REJECT 2>/dev/null \
      || iptables -A OUTPUT -p tcp -m multiport --dports "${tcp_ports}" -j REJECT
    iptables -C OUTPUT -p udp -m multiport --dports "${udp_ports}" -j REJECT 2>/dev/null \
      || iptables -A OUTPUT -p udp -m multiport --dports "${udp_ports}" -j REJECT
  else
    log_warn "iptables not found; outbound abuse-port blocks were not applied"
  fi

  if command -v ip6tables &>/dev/null; then
    ip6tables -C OUTPUT -p tcp -m multiport --dports "${tcp_ports}" -j REJECT 2>/dev/null \
      || ip6tables -A OUTPUT -p tcp -m multiport --dports "${tcp_ports}" -j REJECT || true
    ip6tables -C OUTPUT -p udp -m multiport --dports "${udp_ports}" -j REJECT 2>/dev/null \
      || ip6tables -A OUTPUT -p udp -m multiport --dports "${udp_ports}" -j REJECT || true
  fi
}

# Start service
start_service() {
  log_info "Starting Xray..."
  systemctl restart xray
  sleep 2

  if systemctl is-active --quiet xray; then
    log_info "Xray started successfully"
  else
    log_error "Xray failed to start"
    journalctl -u xray --no-pager -n 20
    exit 1
  fi
}

# Main
main() {
  ensure_dependency curl
  ensure_dependency unzip
  ensure_dependency openssl openssl
  install_xray
  generate_config
  create_service
  open_firewall
  apply_safety_policy
  start_service

  echo ""
  echo "=========================================="
  echo " VLESS+Reality 部署完成 (TCP)"
  echo "=========================================="
  echo "PUBLIC_KEY=${REALITY_PUBLIC_KEY}"
  echo "SHORT_ID=${SHORT_ID}"
  echo "UUID=${UUID}"
  echo "PORT=${PORT}"
  echo "SERVER_NAME=${SERVER_NAME}"
  echo "=========================================="
}

main
