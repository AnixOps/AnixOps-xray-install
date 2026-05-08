# Deployment Guide / 部署指南

## Self-hosted Mode (Free) / 自托管模式

### Local Development / 本地开发

```bash
npm install
cp .env.example .env.local  # Fill in your cloud provider API key
npm run dev
# Visit http://localhost:30000, select "Self-hosted" mode
```

### Deploy to Cloudflare Pages / 部署到 Pages

```bash
# 1. Install Wrangler CLI
npm install -g wrangler

# 2. Login to Cloudflare
npx wrangler login

# 3. Create D1 database
npx wrangler d1 create anixops
# Note the returned database_id and fill it into wrangler.toml

# 4. Run schema migration
npx wrangler d1 execute anixops --remote --file web/workers/db/schema.sql

# 5. Create KV namespace
npx wrangler kv:namespace create anixops-cache
# Note the returned id and fill it into wrangler.toml

# 6. Create queues
npx wrangler queues create provision-tasks
npx wrangler queues create provision-dlq

# 7. Set secrets
npx wrangler secret put PROVISION_SERVER_URL
npx wrangler secret put PROVISION_SERVER_TOKEN
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET

# 8. Deploy
npm run build
npx wrangler pages deploy .next
```

## Rental Mode (Paid) / 按租模式

Requires an additional Provision Server deployment:

### 1. Provision Server Setup / 准备 Provision Server

```bash
# On any VPS (1C1G minimum)
cd provision-server
npm install
npm run build

# Set env vars (copy from .env.example)
# CLOUD_PROVIDER=vultr|digitalocean|aws
# VULTR_API_KEY / DIGITALOCEAN_TOKEN / AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
# SERVER_TOKEN (random string, ≥32 chars, must match Worker)

npm start
# Service listens on 127.0.0.1:3001
```

Supported cloud providers (set `CLOUD_PROVIDER` in `.env`):
- `vultr` — requires `VULTR_API_KEY`
- `digitalocean` — requires `DIGITALOCEAN_TOKEN`
- `aws` — requires `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_SECURITY_GROUP_ID`

Current default and active provider is `vultr`. `digitalocean` and `aws` stay available as retained adapters and do not require business-layer API changes when switching.

For the self-hosted helper scripts in the repo root:

- `npm run selfhosted:init-env`
- `npm run selfhosted:doctor`
- `npm run selfhosted:deploy`

they will automatically read ignored local secret files from `.local-secrets.env`, plus `apikey.txt` / `mail.txt` when present.
`npm run provision:check-env` follows the same rule by default; use `--no-local-overrides` only when you want to validate the example env shape in isolation.

### 2. Configure Cloudflare Worker / 配置 Worker

Fill into `wrangler.toml`:
- `PROVISION_SERVER_URL`: Provision Server address
- `PROVISION_SERVER_TOKEN`: Must match Provision Server's `SERVER_TOKEN`
- `STRIPE_SECRET_KEY`: Stripe API key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret
- `NOTIFICATION_WEBHOOK_URL`: (optional) Renewal reminder webhook URL
- `FRONTEND_URL`: Your Next.js Pages URL (Stripe redirect target)
- `ALLOWED_ORIGINS`: CORS allowed origins (comma-separated)

### 3. Configure Stripe Webhook / 配置 Stripe

```
In Stripe Dashboard:
1. Add Webhook endpoint: https://your-worker.workers.dev/api/payment/webhook
2. Select event: checkout.session.completed
3. Copy Signing secret to STRIPE_WEBHOOK_SECRET
```

### 4. Deploy / 部署

```bash
npx wrangler deploy
```

## Environment Variables / 环境变量清单

### Worker (wrangler.toml vars + secrets)

| Variable | Required | Description |
|---|---|---|
| `PROVISION_SERVER_URL` | Rental mode | Provision server API endpoint |
| `PROVISION_SERVER_TOKEN` | Rental mode | Shared Bearer token (must match SERVER_TOKEN) |
| `STRIPE_SECRET_KEY` | Rental mode | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Rental mode | Stripe webhook signing secret |
| `FRONTEND_URL` | Yes | Next.js Pages URL (Stripe redirect target) |
| `NOTIFICATION_WEBHOOK_URL` | Optional | Telegram bot or generic webhook for renewal reminders |
| `ALLOWED_ORIGINS` | Production | CORS allowed origins (comma-separated) |

### Provision Server (.env)

| Variable | Required | Description |
|---|---|---|
| `CLOUD_PROVIDER` | Yes | `vultr` / `digitalocean` / `aws` |
| `SERVER_TOKEN` | Yes | Shared Bearer token (must match Worker's PROVISION_SERVER_TOKEN) |
| `VULTR_API_KEY` | Vultr | Vultr API Key |
| `DIGITALOCEAN_TOKEN` | DO | DigitalOcean API Token |
| `AWS_ACCESS_KEY_ID` | AWS | AWS Access Key |
| `AWS_SECRET_ACCESS_KEY` | AWS | AWS Secret Key |
| `AWS_REGION` | AWS | AWS region (default `us-east-1`) |
| `AWS_SECURITY_GROUP_ID` | AWS | Security group ID (must allow 22/TCP, 443/TCP, 443/UDP) |
| `PORT` | Optional | Listen port (default `3001`, bound to `127.0.0.1`) |

## Security Checklist / 安全检查清单

Before deploying, confirm:
- [ ] `CLOUD_PROVIDER` is set to the correct provider
- [ ] `SERVER_TOKEN` / `PROVISION_SERVER_TOKEN` are set and match each other (≥32 chars, random)
- [ ] `ALLOWED_ORIGINS` is configured with your domain
- [ ] Stripe webhook signature verification is enabled
- [ ] Provision Server binds to `127.0.0.1` only
- [ ] Firewall restricts access to Provision Server (allow Cloudflare IPs only)
- [ ] SSH keys are auto-generated and registered with cloud provider
- [ ] All services run as non-root users (xray user for xray/hysteria2)
- [ ] Input validation is in place on all API endpoints
- [ ] Rate limiting is active (20 req/min per IP via KV)

## Testing / 测试

```bash
npm run test          # Run all tests (vitest)
npm run test -- --watch  # Watch mode
```

Current coverage: 44 tests across config generators, i18n, deploy store, and type definitions.

## Troubleshooting / 常见问题

### Worker can't reach Provision Server
- Ensure `PROVISION_SERVER_URL` is reachable from Cloudflare Worker
- If using a private VPS, you may need a tunnel (Cloudflare Tunnel recommended)

### SSH deployment fails
- Check that the cloud provider API key has sufficient permissions
- Verify the VPS region and plan are valid for the selected provider
- AWS EC2 may take longer to assign a public IP (up to 2.5 minutes)

### Stripe payment not working
- Ensure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set correctly
- Check that the webhook endpoint URL matches your Worker deployment
- Verify `FRONTEND_URL` points to your actual Pages URL
