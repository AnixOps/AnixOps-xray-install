#!/bin/sh
set -eu

: "${ANIXOPS_API_URL:=http://api:8787}"
: "${BILLING_TICK_CRON:=*/5 * * * *}"
: "${CRYPTO_TOPUP_CRON:=*/2 * * * *}"
: "${AUDIT_ANCHOR_CRON:=17 * * * *}"
: "${COMPLIANCE_STATS_CRON:=*/15 * * * *}"
: "${SCHEDULER_ENABLE_BILLING_TICK:=true}"
: "${SCHEDULER_ENABLE_CRYPTO_TOPUPS:=auto}"
: "${SCHEDULER_ENABLE_AUDIT_ANCHOR:=auto}"
: "${SCHEDULER_ENABLE_COMPLIANCE_STATS:=true}"

ENV_FILE=/tmp/anixops-scheduler.env
CRON_FILE=/tmp/anixops-crontab

write_export() {
  key="$1"
  value="$(printenv "$key" 2>/dev/null || true)"
  if [ -z "$value" ]; then
    return 0
  fi
  escaped="$(printf "%s" "$value" | sed "s/'/'\\\\''/g")"
  printf "export %s='%s'\n" "$key" "$escaped" >> "$ENV_FILE"
}

is_disabled() {
  case "$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    false|0|no|off|disabled) return 0 ;;
    *) return 1 ;;
  esac
}

is_enabled() {
  case "$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    true|1|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}

has_all_env() {
  for key in "$@"; do
    value="$(printenv "$key" 2>/dev/null || true)"
    if [ -z "$value" ]; then
      return 1
    fi
  done
  return 0
}

add_job() {
  name="$1"
  schedule="$2"
  mode="$3"
  command="$4"
  shift 4

  if is_disabled "$mode"; then
    return 0
  fi
  if ! is_enabled "$mode" && ! has_all_env "$@"; then
    return 0
  fi

  printf "%s . %s && cd /app && %s >> /var/log/anixops/%s.log 2>&1\n" \
    "$schedule" "$ENV_FILE" "$command" "$name" >> "$CRON_FILE"
}

rm -f "$ENV_FILE" "$CRON_FILE"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

for key in \
  ANIXOPS_API_URL API_SECRET \
  CHAIN_ENVIRONMENT CHAIN_TESTNET_WHITELIST_EMAILS \
  CRYPTO_TOPUP_CHAIN CRYPTO_TOPUP_ASSET CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED \
  CRYPTO_TOPUP_RPC_URL CRYPTO_TOPUP_SIGNER_PRIVATE_KEY CRYPTO_TOPUP_RECEIVER_ADDRESS \
  CRYPTO_TOPUP_TOKEN_ADDRESS CRYPTO_TOPUP_TOKEN_DECIMALS CRYPTO_ALERT_WEBHOOK_URL \
  AUDIT_ANCHOR_CHAIN AUDIT_ANCHOR_RPC_URL AUDIT_ANCHOR_SIGNER_PRIVATE_KEY \
  AUDIT_ANCHOR_TARGET_ADDRESS AUDIT_ANCHOR_MIN_NATIVE_BALANCE AUDIT_ANCHOR_ALERT_WEBHOOK_URL; do
  write_export "$key"
done

{
  echo "SHELL=/bin/sh"
  echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
} > "$CRON_FILE"

add_job "billing-tick" "$BILLING_TICK_CRON" "$SCHEDULER_ENABLE_BILLING_TICK" \
  'node scripts/billing-tick-worker.js --api "$ANIXOPS_API_URL" --json' \
  API_SECRET

add_job "crypto-topups" "$CRYPTO_TOPUP_CRON" "$SCHEDULER_ENABLE_CRYPTO_TOPUPS" \
  'node scripts/crypto-topup-worker.js --api "$ANIXOPS_API_URL" --json' \
  API_SECRET CRYPTO_TOPUP_RPC_URL CRYPTO_TOPUP_RECEIVER_ADDRESS CRYPTO_TOPUP_TOKEN_ADDRESS

add_job "audit-anchor" "$AUDIT_ANCHOR_CRON" "$SCHEDULER_ENABLE_AUDIT_ANCHOR" \
  'node scripts/audit-anchor-worker.js --api "$ANIXOPS_API_URL" --json' \
  API_SECRET AUDIT_ANCHOR_RPC_URL AUDIT_ANCHOR_SIGNER_PRIVATE_KEY

add_job "compliance-stats" "$COMPLIANCE_STATS_CRON" "$SCHEDULER_ENABLE_COMPLIANCE_STATS" \
  'node scripts/compliance-stats-worker.js --api "$ANIXOPS_API_URL" --json' \
  API_SECRET

crontab "$CRON_FILE"
echo "AnixOps scheduler started with $(($(wc -l < "$CRON_FILE" | tr -d ' ') - 2)) job(s)."
exec crond -f -l 8
