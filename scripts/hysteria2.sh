#!/bin/bash
# Hysteria2 Server Installation Script (Non-interactive)
# Official docs: https://v2.hysteria.network/docs/
# Usage: ./hysteria2.sh --port 443|20000-50000 --password PASSWORD [--cert CERT] [--key KEY] [--obfs OBFS_PASSWORD]

set -euo pipefail

INSTALL_BIN="/usr/local/bin/hysteria"
CONFIG_DIR="/etc/hysteria"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"
SERVICE_FILE="/etc/systemd/system/hysteria-server.service"
SYSCTL_FILE="/etc/sysctl.d/99-hysteria.conf"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
PORT="443"
PASSWORD=""
CERT=""
KEY=""
OBFS=""
DOMAIN=""
EMAIL="auto@anixops.com"
PORT_IS_RANGE=false
PORT_START=""
PORT_END=""
FIREWALL_BACKEND=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --port)     PORT="$2";     shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --cert)     CERT="$2";     shift 2 ;;
    --key)      KEY="$2";      shift 2 ;;
    --obfs)     OBFS="$2";     shift 2 ;;
    --domain)   DOMAIN="$2";   shift 2 ;;
    --email)    EMAIL="$2";    shift 2 ;;
    *) shift ;;
  esac
done

normalize_port_spec() {
  local raw="$1"
  if [[ "$raw" =~ ^([0-9]+)-([0-9]+)$ ]]; then
    local start="${BASH_REMATCH[1]}"
    local end="${BASH_REMATCH[2]}"
    if [[ "$start" -lt 1 || "$end" -gt 65535 || "$start" -gt "$end" ]]; then
      return 1
    fi
    PORT_IS_RANGE=true
    PORT_START="$start"
    PORT_END="$end"
    printf '%s-%s' "$start" "$end"
    return 0
  fi

  if [[ "$raw" =~ ^[0-9]+$ ]] && [[ "$raw" -ge 1 && "$raw" -le 65535 ]]; then
    PORT_IS_RANGE=false
    PORT_START="$raw"
    PORT_END="$raw"
    printf '%s' "$raw"
    return 0
  fi

  return 1
}

detect_firewall_backend() {
  if command -v nft &>/dev/null; then
    printf '%s' "nftables"
    return 0
  fi

  if command -v iptables &>/dev/null; then
    printf '%s' "iptables"
    return 0
  fi

  return 1
}

# Validate inputs
PORT_INPUT="$PORT"
if ! PORT="$(normalize_port_spec "$PORT_INPUT")"; then
  log_error "Invalid port: $PORT_INPUT"
  exit 1
fi

if [[ -n "$PASSWORD" && ${#PASSWORD} -lt 8 ]]; then
  log_error "Password must be at least 8 characters"
  exit 1
fi

if [[ "$PORT_IS_RANGE" == true ]]; then
  if FIREWALL_BACKEND="$(detect_firewall_backend)"; then
    log_info "Detected firewall backend for port hopping: ${FIREWALL_BACKEND}"
  else
    log_warn "No nft/iptables backend detected; Hysteria2 port hopping may fail"
  fi
fi

if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  log_error "Invalid domain: $DOMAIN"
  exit 1
fi

# Check root
if [[ $EUID -ne 0 ]]; then
  log_error "Must run as root"
  exit 1
fi

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
  x86_64)  HY_ARCH="linux-amd64" ;;
  aarch64) HY_ARCH="linux-arm64" ;;
  armv7l)  HY_ARCH="linux-armv7" ;;
  *)       log_error "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Install Hysteria2 binary
install_hysteria() {
  log_info "Downloading Hysteria2 (${HY_ARCH})..."

  local tmp_bin=$(mktemp)
  curl -fsSL -o "$tmp_bin" "https://download.hysteria.network/app/latest/hysteria-${HY_ARCH}"

  chmod +x "$tmp_bin"
  mv "$tmp_bin" "$INSTALL_BIN"

  log_info "Hysteria2 installed to ${INSTALL_BIN}"
  log_info "Version: $($INSTALL_BIN version)"
}

# Generate self-signed cert if no cert provided
generate_self_signed_cert() {
  local fake_domain="${DOMAIN:-example.com}"

  log_info "Generating self-signed certificate for ${fake_domain}..."
  mkdir -p "$CONFIG_DIR"

  openssl req -x509 -nodes -newkey ec:<(openssl ecparam -name prime256v1) \
    -keyout "${CONFIG_DIR}/server.key" \
    -out    "${CONFIG_DIR}/server.crt" \
    -days 3650 \
    -subj "/CN=${fake_domain}" \
    -addext "subjectAltName=DNS:${fake_domain}" 2>/dev/null

  CERT="${CONFIG_DIR}/server.crt"
  KEY="${CONFIG_DIR}/server.key"
  log_info "Self-signed cert generated (client needs to set insecure: true or pin SHA256)"
}

# Create systemd service
create_service() {
  log_info "Creating systemd service..."

  # Create unprivileged hysteria user if not exists
  if ! id -u hysteria &>/dev/null; then
    useradd -r -s /usr/sbin/nologin -M hysteria
    log_info "Created hysteria user"
  fi

  # Set proper ownership
  chown -R hysteria:hysteria "$CONFIG_DIR"
  chown hysteria:hysteria "$INSTALL_BIN"

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Hysteria Server Service
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_BIN} server --config ${CONFIG_FILE}
User=hysteria
Group=hysteria
Environment=HYSTERIA_LOG_LEVEL=info
${FIREWALL_BACKEND:+Environment=HYSTERIA_FIREWALL_BACKEND=${FIREWALL_BACKEND}}
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_RAW
NoNewPrivileges=true
LimitNOFILE=infinity

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable hysteria-server
}

# Generate config
generate_config() {
  log_info "Generating Hysteria2 config..."
  mkdir -p "$CONFIG_DIR"

  # Generate password if not provided
  if [[ -z "$PASSWORD" ]]; then
    PASSWORD=$(openssl rand -base64 24)
    log_info "Generated random password: ${PASSWORD}"
  fi

  # Generate self-signed cert if no cert provided
  if [[ -z "$CERT" || -z "$KEY" ]]; then
    if [[ -n "$DOMAIN" ]]; then
      log_info "Using domain: ${DOMAIN} (client needs insecure: true)"
    fi
    generate_self_signed_cert
  fi

  # Build YAML config
  cat > "$CONFIG_FILE" <<EOF
listen: :${PORT}

tls:
  cert: ${CERT}
  key: ${KEY}
  sniGuard: disable
EOF

  # Add password auth
  cat >> "$CONFIG_FILE" <<EOF

auth:
  type: password
  password: "${PASSWORD}"
EOF

  # Add obfuscation if specified
  if [[ -n "$OBFS" ]]; then
    cat >> "$CONFIG_FILE" <<EOF

obfs:
  type: salamander
  salamander:
    password: "${OBFS}"
EOF
  fi

  # Add bandwidth limits
  cat >> "$CONFIG_FILE" <<EOF

congestion:
  type: bbr
  bbrProfile: standard

quic:
  initStreamReceiveWindow: 16777216
  maxStreamReceiveWindow: 16777216

speedTest: false
EOF

  log_info "Config generated at ${CONFIG_FILE}"
  echo "HY2_PASSWORD=${PASSWORD}"
  echo "HY2_PORT=${PORT}"
}

# Kernel tuning
tune_kernel() {
  log_info "Applying kernel tuning..."

  cat > "$SYSCTL_FILE" <<EOF
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 16777216
net.core.wmem_default = 16777216
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
fs.file-max = 1048576
EOF

  sysctl -p "$SYSCTL_FILE"
}

# Firewall
open_firewall() {
  if [[ "$PORT_IS_RANGE" == true ]]; then
    if [[ -n "$FIREWALL_BACKEND" ]]; then
      log_info "Port hopping will be managed by Hysteria via ${FIREWALL_BACKEND}; skipping ufw/firewalld"
    else
      log_warn "No Hysteria firewall backend detected; skipping host firewall changes for port hopping"
    fi
    return 0
  fi

  log_info "Opening port ${PORT}/udp..."

  if command -v ufw &>/dev/null; then
    ufw allow "${PORT}/udp"
    ufw --force enable 2>/dev/null || true
  elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port="${PORT}/udp"
    firewall-cmd --reload
  else
    log_warn "No firewall tool found, ensure port ${PORT}/udp is open"
  fi
}

apply_safety_policy() {
  log_info "Applying outbound abuse-port blocks..."
  local tcp_ports=("25" "465" "587" "6881:6999" "51413")
  local udp_ports=("6881:6999" "51413")

  add_reject_rule() {
    local tool="$1"
    local proto="$2"
    local port_spec="$3"

    if ! "$tool" -C OUTPUT -p "$proto" --dport "$port_spec" -j REJECT 2>/dev/null; then
      "$tool" -A OUTPUT -p "$proto" --dport "$port_spec" -j REJECT
    fi
  }

  if command -v iptables &>/dev/null; then
    # Use one rule per port spec because multiport rejects range syntax like 6881:6999.
    for port in "${tcp_ports[@]}"; do
      add_reject_rule iptables tcp "$port"
    done
    for port in "${udp_ports[@]}"; do
      add_reject_rule iptables udp "$port"
    done
  else
    log_warn "iptables not found; outbound abuse-port blocks were not applied"
  fi

  if command -v ip6tables &>/dev/null; then
    for port in "${tcp_ports[@]}"; do
      add_reject_rule ip6tables tcp "$port" || true
    done
    for port in "${udp_ports[@]}"; do
      add_reject_rule ip6tables udp "$port" || true
    done
  fi
}

# Start service
start_service() {
  log_info "Starting Hysteria2..."
  systemctl restart hysteria-server
  sleep 2

  if systemctl is-active --quiet hysteria-server; then
    log_info "Hysteria2 started successfully"
  else
    log_error "Hysteria2 failed to start"
    journalctl -u hysteria-server --no-pager -n 20
    exit 1
  fi
}

# Main
main() {
  install_hysteria
  generate_config
  create_service
  tune_kernel
  open_firewall
  apply_safety_policy
  start_service

  echo ""
  echo "=========================================="
  echo " Hysteria2 部署完成"
  echo "=========================================="
  echo " 端口: ${PORT}"
  echo " 密码: ${PASSWORD}"
  echo " 证书: ${CERT}"
  if [[ -n "$OBFS" ]]; then
    echo " 混淆: ${OBFS}"
  fi
  echo "=========================================="
  echo ""
  echo " 客户端连接:"
  echo "  hysteria2://user:${PASSWORD}@<SERVER_IP>:${PORT}/?insecure=1"
  echo "=========================================="
}

main
