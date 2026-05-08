# AnixOps

Zero-knowledge node deployment platform. One-click provisioning for VLESS Reality and Hysteria2 proxies.

全自动代理节点部署。输入 API Key 或按租即用，无需 SSH。

## Modes / 两种模式

| Mode | Description |
|---|---|
| **Self-hosted (Free)** | Provide your own cloud API key → automated deployment to your VPS |
| **Rental ($0.50/hr)** | Pick protocol + duration, pay via Stripe or redeem code, get an exclusive node. 1h minimum, destroy anytime. |

## Supported Protocols

| Protocol | Transport | Use Case |
|---|---|---|
| VLESS + Reality + gRPC | TCP | Best anti-detection, no domain needed |
| Hysteria2 | UDP/QUIC | Best for gaming and video |

## Cloud Providers / 云厂商

Vultr (primary), DigitalOcean, AWS EC2 (free tier eligible).

Current self-hosted default and active provider: `Vultr`.
DigitalOcean and AWS adapters remain supported and can be switched on without changing the business-layer APIs.

## Tech Stack

- **Frontend**: Next.js SSG → Cloudflare Pages
- **API**: Hono → Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV (sessions, configs, rate limiting)
- **Queue**: Cloudflare Queues (async provision/destroy tasks)
- **Cron**: Worker cron (expiry checks, auto-destroy, renewal reminders)
- **Provision Server**: Fastify + node-ssh (independent VPS)
- **Payments**: Stripe Checkout + webhook verification

## Quick Start

### Local Development

```bash
npm install

# Next.js dev server
npm run dev

# Worker locally (needs wrangler login)
npm run worker:dev

# Provision server locally
npm run provision:dev
```

### Deploy to Cloudflare

```bash
npx wrangler login

# 1. D1 database
npx wrangler d1 create anixops
# Paste database_id into wrangler.toml

# 2. Schema migration
npx wrangler d1 execute anixops --remote --file web/workers/db/schema.sql

# 3. KV namespace
npx wrangler kv:namespace create anixops-cache
# Paste id into wrangler.toml

# 4. Queues
npx wrangler queues create provision-tasks
npx wrangler queues create provision-dlq

# 5. Secrets
npx wrangler secret put PROVISION_SERVER_URL
npx wrangler secret put PROVISION_SERVER_TOKEN
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET

# 6. Deploy
npm run pages:deploy    # Frontend
npm run worker:deploy   # API
```

### Deploy Provision Server

Required for rental mode. Runs on any VPS (1C1G minimum).

```bash
cd provision-server
npm install
npm run build

# Set env vars:
# CLOUD_PROVIDER=vultr|digitalocean|aws
# VULTR_API_KEY / DIGITALOCEAN_TOKEN / AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
# SERVER_TOKEN (shared secret with Worker)

npm start
```

## Environment Variables

### Worker (wrangler.toml)

| Variable | Required | Description |
|---|---|---|
| `PROVISION_SERVER_URL` | Yes | Provision server API endpoint |
| `PROVISION_SERVER_TOKEN` | Yes | Shared Bearer token |
| `STRIPE_SECRET_KEY` | Yes | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `FRONTEND_URL` | Yes | Next.js Pages URL (Stripe redirect) |
| `NOTIFICATION_WEBHOOK_URL` | No | Telegram bot or generic webhook for renewal reminders |
| `ALLOWED_ORIGINS` | Yes | CORS allowed origins (comma-separated) |

### Provision Server

| Variable | Required | Description |
|---|---|---|
| `CLOUD_PROVIDER` | Yes | `vultr`, `digitalocean`, or `aws` |
| `SERVER_TOKEN` | Yes | Shared Bearer token |
| `VULTR_API_KEY` | Vultr | Vultr API key |
| `DIGITALOCEAN_TOKEN` | DO | DigitalOcean API token |
| `AWS_ACCESS_KEY_ID` | AWS | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS | AWS secret key |
| `AWS_SECURITY_GROUP_ID` | AWS | Security group (allow 22/TCP, 443/TCP, 443/UDP) |

## npm Scripts

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Next.js production build |
| `npm run test` | Run vitest tests |
| `npm run worker:dev` | Wrangler local dev |
| `npm run worker:deploy` | Deploy Worker to Cloudflare |
| `npm run worker:d1` | Apply D1 schema locally |
| `npm run provision:dev` | Run provision server in dev |
| `npm run pages:build` | Build for Cloudflare Pages |
| `npm run pages:deploy` | Build + deploy frontend |

## Project Structure

```
web/
  app/                    Next.js app router
    api/                  API routes (self-hosted deploy, rental config)
    rental/               Rental pages (wizard, success, cancel)
  components/             React components
    self-hosted/          SelfHostedWizard.tsx
    rental/               RentalWizard.tsx, RentalDashboard.tsx
  workers/                Cloudflare Worker (Hono API)
    lib/                  billing.ts, db.ts
    index.ts              Worker entry (routes, queue consumer, cron)
  lib/
    config/               generator.ts (client config builders)
    deploy/               types.ts, store.ts, orchestrator.ts
    i18n/                 locales.ts, store.ts (zh/en)
    api/                  client.ts (centralized Worker API calls)
provision-server/
  src/
    server.ts             Fastify entry
    provision.ts          VPS creation + SSH deployment
    destroy.ts            SSH cleanup + VPS deletion
    providers/            Vultr, DigitalOcean, AWS abstractions
scripts/
  vless-reality.sh        Xray core install + VLESS Reality config
  hysteria2.sh            Hysteria2 install + config
  destroy.sh              Pre-deletion cleanup
docs/
  knowledge-base/         User-facing documentation
  deploy-guide.md         Detailed deployment instructions
  security-review.md      Security audit checklist
```

## Security

19/22 security issues fixed, 3 monitored (acceptable for MVP). See [docs/security-review.md](docs/security-review.md).

Key measures: Bearer token auth, KV session management, user isolation (`user_id` scoped queries), Stripe webhook signature verification, SSH ed25519 key auth, KV-based rate limiting (20 req/min), provision server bound to `127.0.0.1`, non-root users for xray/hysteria2, input validation on all endpoints, CORS restricted to configured origins.

## Pricing

| Duration | Unit Price | Total | Discount |
|---|---|---|---|
| 1 hour | $0.50/h | $0.50 | - |
| 6 hours | $0.50/h | $3.00 | - |
| 12 hours | $0.45/h | $5.40 | 10% off |
| 24 hours | $0.40/h | $9.60 | 20% off |

VPS cost ~$0.007/hr (Vultr minimum), healthy margin.

## License

AGPL-3.0
