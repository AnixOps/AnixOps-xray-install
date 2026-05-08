# AnixOps 自托管部署指南

## 概述

AnixOps 支持两种部署模式：

1. **Cloudflare Workers** (默认): Serverless, 自动扩展, 低运维成本
2. **自托管** (Self-Hosted): 完全控制, 适合私有化部署, 无需 Cloudflare

当前云厂商策略：

- 保留 `Vultr`、`DigitalOcean`、`AWS` 三家 provider API 适配层
- 当前默认和实际运行选择：`Vultr`
- 其他两家保持可切换，不从代码和文档中删除

## 架构对比

| 组件 | Cloudflare | 自托管替代 |
|------|-----------|-----------|
| 运行时 | Cloudflare Workers | Node.js + Docker |
| 数据库 | D1 (SQLite) | PostgreSQL |
| 缓存 | KV | Redis |
| 队列 | Cloudflare Queues | BullMQ (Redis-based) |
| 前端 | Cloudflare Pages | Next.js (Docker) |
| Provision | 独立 Node.js | 独立 Node.js |

## 快速开始

### 1. 环境准备

需要安装:
- Docker
- Docker Compose

### 2. 配置环境变量

```bash
# 复制示例配置
cp .env.selfhosted.example .env.selfhosted

# 编辑配置
# 必需配置:
PROVISION_SERVER_TOKEN=your-secure-token
API_SECRET=your-admin-secret
POSTGRES_PASSWORD=your-postgres-password
REDIS_PASSWORD=your-redis-password
FRONTEND_URL=http://localhost:30000
ALLOWED_ORIGINS=http://localhost:30000
WEB_PORT=30000
CLOUD_PROVIDER=vultr
VPS_REGION=nrt
VPS_PLAN=vhf-1c-1gb
CHAIN_ENVIRONMENT=testnet
CHAIN_TESTNET_WHITELIST_EMAILS=qa1@example.com,qa2@example.com
CRYPTO_TOPUP_CHAIN=base
CRYPTO_TOPUP_ASSET=USDT
CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED=12
CRYPTO_TOPUP_RPC_URL=https://sepolia.base.org
AUDIT_ANCHOR_CHAIN=base
AUDIT_ANCHOR_RPC_URL=https://sepolia.base.org
# Leave empty to use the built-in Next.js /api proxy.
NEXT_PUBLIC_WORKER_URL=

# 可选支付配置:
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# 可选通知配置:
NOTIFICATION_WEBHOOK_URL=https://api.telegram.org/bot.../sendMessage
```

当前默认 `CLOUD_PROVIDER=vultr`。如果后续切换到 `digitalocean` 或 `aws`，只需要补对应凭据，不需要改业务层接口。

如果你用本地 secret 文件辅助初始化：

- `npm run selfhosted:init-env`、`npm run selfhosted:doctor` 和 `npm run selfhosted:deploy` 会自动读取仓库根目录下的 `.local-secrets.env`
- `npm run provision:check-env` 也会默认读取这些本地 secret 覆盖；只有检查示例文件时才需要 `--no-local-overrides`
- 如果同时存在，`apikey.txt` 和 `mail.txt` 会覆盖 `.local-secrets.env` 中同名 provider / SMTP 字段
- `apikey.txt` 单行裸 token 仍默认按 `VULTR_API_KEY` 处理
- 如果需要切到其他 provider，`apikey.txt` 里直接写显式键名即可，例如 `DIGITALOCEAN_TOKEN=...` 或 `AWS_ACCESS_KEY_ID=...`
- 当 `apikey.txt` 里只明确出现一家的 provider 凭据时，`npm run selfhosted:init-env` 会自动推断对应 `CLOUD_PROVIDER`
- 如果 `CLOUD_PROVIDER` 和实际填入的 provider 凭据对不上，`npm run provision:check-env` 会直接给出切换提示

如果你准备继续完成“真实链上充值”或“真实链上审计锚定”，先看：

- [manual-input-checklist.md](/root/code/AnixOps-xray-install/docs/manual-input-checklist.md)
- [evm-testnet-playbook.md](/root/code/AnixOps-xray-install/docs/evm-testnet-playbook.md)

里面已经列出需要人工补充的：

- 测试链环境与白名单邮箱
- 链选择
- 资产选择
- 确认数
- RPC 地址
- 收款钱包私钥
- ERC20 合约地址与 decimals
- 锚定钱包私钥
- 告警 webhook

测试服默认方案直接用：

```bash
npm run crypto:bootstrap-testnet -- --chain base-sepolia --whitelist-emails qa1@example.com --write-env
```

这条命令会在项目根目录生成测试钱包，并把 `Base Sepolia` 的测试服默认值直接写回本地 `.env.selfhosted`。如果缺依赖，先在仓库根目录跑一次 `npm install`。

### 3. 启动服务

```bash
# 启动所有服务
docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml up -d

# 查看日志
docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml logs -f

# 停止服务
docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml down
```

访问: http://localhost:30000

首页保留 `Console Wallet` 登录入口，普通用户可用邮箱魔法链接进入 `/console/wallet`。钱包充值页会显示精确到账金额、网络、过期时间和复制按钮，待确认单据会自动轮询状态。

## 测试服建议

如果这是测试服，建议保持：

- `CHAIN_ENVIRONMENT=testnet`
- `CHAIN_TESTNET_WHITELIST_EMAILS=` 只写允许测试链功能的邮箱

这样普通租用和后台仍可访问，但链上相关能力只对测试白名单开放。

## 内置调度服务

`docker-compose.selfhosted.yml` 已包含 `scheduler` 容器。它会用同一套 `.env.selfhosted` 配置定时触发这些内部 worker：

默认频率：

- `billing-tick-worker.js`：每 `5` 分钟一次
- `crypto-topup-worker.js`：每 `2` 分钟一次，`auto` 模式下只在链上充值 env 完整时启用
- `audit-anchor-worker.js`：每小时第 `17` 分钟一次，`auto` 模式下只在 anchor RPC 和私钥完整时启用
- `compliance-stats-worker.js`：每 `15` 分钟一次

可以在 `.env.selfhosted` 里覆盖：

```bash
BILLING_TICK_CRON=*/5 * * * *
CRYPTO_TOPUP_CRON=*/2 * * * *
AUDIT_ANCHOR_CRON=17 * * * *
COMPLIANCE_STATS_CRON=*/15 * * * *
SCHEDULER_ENABLE_BILLING_TICK=true
SCHEDULER_ENABLE_CRYPTO_TOPUPS=auto
SCHEDULER_ENABLE_AUDIT_ANCHOR=auto
SCHEDULER_ENABLE_COMPLIANCE_STATS=true
```

如果需要手动触发，仍可以在远端主机上直接执行：

```bash
cd /opt/anixops-selfhosted
node scripts/billing-tick-worker.js --json
node scripts/crypto-topup-worker.js --json
node scripts/audit-anchor-worker.js --json
node scripts/compliance-stats-worker.js --json
```

如果已经配置：

- `CRYPTO_ALERT_WEBHOOK_URL`
- `AUDIT_ANCHOR_ALERT_WEBHOOK_URL`

那么：

- `crypto-topup-worker.js` 会在出现歧义匹配或 worker 失败时发告警
- `audit-anchor-worker.js` 会在 batch 创建后无法自动 finalize、链上发送失败或 finalize 失败时发告警

如果 `audit-anchor-worker.js` 的告警里已经带出 `txHash`，优先用同一个交易 hash 做人工 finalize，而不是再次发送链上交易：

```bash
cd /opt/anixops-selfhosted
node scripts/audit-anchor-worker.js --tx-hash <existing-tx-hash> --json
```

如果你更习惯从本地运维机触发，而不是 SSH 到远端手动执行，也可以直接用：

```bash
node scripts/remote-ops.js job billing
node scripts/remote-ops.js job crypto-topups
node scripts/remote-ops.js job audit-anchor
node scripts/remote-ops.js job compliance-stats
node scripts/remote-ops.js audit-anchor-smoke
```

`audit-anchor-smoke` 默认使用 `--confirmation-mode synthetic`，适合做闭环验收；如果你需要 `auto` 或 `manual`，仍建议直接跑 `node scripts/audit-anchor-smoke.js`。

如果你选择不用内置 `scheduler` 容器，也可以在主机 crontab 中手动配置：

```cron
*/5 * * * * cd /opt/anixops-selfhosted && node scripts/billing-tick-worker.js --json >> /var/log/anixops-billing.log 2>&1
* * * * * cd /opt/anixops-selfhosted && node scripts/crypto-topup-worker.js --json >> /var/log/anixops-crypto-topups.log 2>&1
*/15 * * * * cd /opt/anixops-selfhosted && node scripts/audit-anchor-worker.js --json >> /var/log/anixops-audit-anchor.log 2>&1
*/10 * * * * cd /opt/anixops-selfhosted && node scripts/compliance-stats-worker.js --json >> /var/log/anixops-compliance.log 2>&1
```

如果测试链配置还没填完整，`crypto-topup-worker.js` 会跳过，不会直接乱入账。

## 服务说明

| 服务 | 端口 | 说明 |
|-----|------|------|
| web | `WEB_PORT`，默认 30000 | Next.js 前端 |
| api | 8787 | Hono API 服务 |
| provision | 3001 (容器内) | VPS 创建和部署 |
| scheduler | 无公开端口 | Billing、crypto topup、audit anchor、compliance stats 定时 worker |
| postgres | 5432 (容器内) | PostgreSQL 数据库 |
| redis | 6379 (容器内) | Redis 缓存和队列 |

## 数据持久化

数据存储在 Docker volumes:
- `postgres_data`: PostgreSQL 数据
- `redis_data`: Redis 持久化数据
- `provision-ssh`: SSH 密钥

## 数据库备份

```bash
# 备份
docker exec anixops-audit-postgres pg_dump -U anixops anixops > backup.sql

# 恢复
docker exec -i anixops-audit-postgres psql -U anixops anixops < backup.sql
```

## 生成兑换码

```bash
# 进入 API 容器
docker exec -it anixops-audit-api sh

# 生成兑换码
npm run db:generate-codes -- 10 8
```

## Nginx 反向代理 (生产)

```nginx
server {
    listen 80;
    server_name anixops.example.com;

    location / {
        proxy_pass http://localhost:30000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
    }
}
```

## 与 Cloudflare Workers 的差异

1. **Session 存储**: KV → Redis (TTL 自动处理)
2. **Cron 任务**: Cron Triggers → Node.js setInterval
3. **队列**: Cloudflare Queues → BullMQ
4. **数据库**: D1 → PostgreSQL (语法略有不同)

## 优点

- ✅ 完全数据控制
- ✅ 支持私有网络
- ✅ 可使用本地资源
- ✅ 无 CF 用量限制
- ✅ 离线开发环境

## 缺点

- ❌ 需要运维 (备份, 更新, 监控)
- ❌ 需要服务器成本
- ❌ 没有自动全球 CDN
- ❌ 需要管理数据库

## 混合部署

也可以部分使用 CF，部分自托管：
- 数据库: PostgreSQL (自托管)
- API: Cloudflare Workers (连接外部 PG)
- 前端: Cloudflare Pages

这样获得 CF 的 CDN 同时保持数据控制。
