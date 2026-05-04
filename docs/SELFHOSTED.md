# AnixOps 自托管部署指南

## 概述

AnixOps 支持两种部署模式：

1. **Cloudflare Workers** (默认): Serverless, 自动扩展, 低运维成本
2. **自托管** (Self-Hosted): 完全控制, 适合私有化部署, 无需 Cloudflare

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
REDIS_PASSWORD=your-redis-password
FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_WORKER_URL=http://localhost:8787

# 可选支付配置:
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# 可选通知配置:
NOTIFICATION_WEBHOOK_URL=https://api.telegram.org/bot.../sendMessage
```

### 3. 启动服务

```bash
# 启动所有服务
docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml up -d

# 查看日志
docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml logs -f

# 停止服务
docker compose --env-file .env.selfhosted -f docker-compose.selfhosted.yml down
```

访问: http://localhost:3000

## 服务说明

| 服务 | 端口 | 说明 |
|-----|------|------|
| web | 3000 | Next.js 前端 |
| api | 8787 | Hono API 服务 |
| provision | 3000 (容器内) | VPS 创建和部署 |
| postgres | 5432 | PostgreSQL 数据库 |
| redis | 6379 | Redis 缓存和队列 |

## 数据持久化

数据存储在 Docker volumes:
- `postgres_data`: PostgreSQL 数据
- `redis_data`: Redis 持久化数据
- `provision-ssh`: SSH 密钥

## 数据库备份

```bash
# 备份
docker exec anixops-postgres pg_dump -U anixops anixops > backup.sql

# 恢复
docker exec -i anixops-postgres psql -U anixops anixops < backup.sql
```

## 生成兑换码

```bash
# 进入 API 容器
docker exec -it anixops-api sh

# 生成兑换码
npm run db:generate-codes -- 10 8
```

## Nginx 反向代理 (生产)

```nginx
server {
    listen 80;
    server_name anixops.example.com;

    location / {
        proxy_pass http://localhost:3000;
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
