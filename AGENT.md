# AGENT.md

## 目的

这是一份给后续开发者和代理使用的仓库操作指引。当前仓库已经把基础能力铺开，后续工作主要集中在未完成项的收口、测试链联调、生产决策和少量产品化补齐。

## 事实来源

以下文档是当前状态的主要来源，优先于旧印象和过期说明：

- [docs/current-state-audit.md](docs/current-state-audit.md)
- [docs/implementation-gap-checklist.md](docs/implementation-gap-checklist.md)
- [docs/manual-input-checklist.md](docs/manual-input-checklist.md)
- [docs/payment-balance-model.md](docs/payment-balance-model.md)
- [docs/long-term-api-plan.md](docs/long-term-api-plan.md)
- [docs/user-console-compliance-roadmap.md](docs/user-console-compliance-roadmap.md)
- [docs/evm-testnet-playbook.md](docs/evm-testnet-playbook.md)

## 当前默认值

| 项目 | 当前默认 |
|---|---|
| 测试服链路 | `Base Sepolia + mock USDT + 白名单邮箱` |
| 测试服模式 | `CHAIN_ENVIRONMENT=testnet` |
| 充值确认数 | `12` |
| 充值和锚定链 | 测试环境优先保持一致 |
| 充值私钥与锚定私钥 | 必须分离，不能复用 |
| 租用支付模型 | 只保留 `余额支付` 和 `兑换码` |
| 余额充值入口 | `Stripe`、`钱包支付`、`X402` |
| 生产云厂商默认 | `Vultr` |
| 可切换云厂商 | `DigitalOcean`、`AWS` |
| 自托管调度 | `scheduler` 容器承接 |

## 当前仍待推进

- 真实链上充值 provider、地址托管、确认监听、汇率源和对账。
- 支付模型收口：租用页只保留余额/兑换码，`Stripe`、钱包支付和 `X402` 下沉到余额充值。
- 审计 anchor 的测试链实跑、`txHash` / receipt 恢复流程和生产主网决策。
- 合规统计更细的管理端和控制台展示。
- 合规模式的产品边界，以及 `Hysteria2` 在合规模式中的去留。
- `web/workers/index.ts` 这条 Worker 版 API 的去留。

## 敏感信息与安全边界

- 不要读取、打印或复述 `.local-secrets.env` 的内容。
- 不要把私钥写进 git、示例 env、构建产物、日志或前端返回值。
- 优先使用密钥管理器；如果只能用文件，私钥只应存在于远端运行环境里。
- 充值私钥和锚定私钥必须隔离。
- 所有链上动作先小额验证，再扩大范围。

## 编辑约定

- 保持改动小而明确，优先贴合仓库现有结构和脚本。
- 不要回退你没有改过的用户改动。
- 文档类改动只保留未完成项，已完成项不要再重复展开成大表。
- 涉及链路、资金、密钥、权限或生产部署的改动，先对照文档里的未完成项再动代码。
- 默认使用 ASCII；只有在现有文件已经是中文或需要中文表达时才写中文内容。

## 常用命令

```bash
npm install
npm run lint
npm test
npm run build
npm run security:scan
npm run provision:check-example
```

```bash
# 本地开发
npm run dev
npm run worker:dev
npm run provision:dev
```

```bash
# EVM 测试链初始化
npm run crypto:bootstrap-testnet -- --chain base-sepolia --whitelist-emails qa@example.com --write-env
```

## 相关目录

- `server/`：Core API、账本、合规、审计、充值和探测逻辑。
- `provision-server/`：云厂商适配、VPS 创建/销毁、SSH 部署和探测接入。
- `web/`：Next.js 前端、后台页面和 API 代理。
- `scripts/`：测试链、锚定、充值、远端运维和安全检查脚本。
- `docs/`：状态文档、测试链手册、运行手册和安全说明。

## 先看什么

如果任务和链上充值、测试链、锚定或私钥有关，先看：

- [docs/manual-input-checklist.md](docs/manual-input-checklist.md)
- [docs/evm-testnet-playbook.md](docs/evm-testnet-playbook.md)

如果任务和支付、余额、充值或兑换码有关，先看：

- [docs/payment-balance-model.md](docs/payment-balance-model.md)

如果任务和产品边界、未完成项或路线图有关，先看：

- [docs/current-state-audit.md](docs/current-state-audit.md)
- [docs/implementation-gap-checklist.md](docs/implementation-gap-checklist.md)
- [docs/long-term-api-plan.md](docs/long-term-api-plan.md)
- [docs/user-console-compliance-roadmap.md](docs/user-console-compliance-roadmap.md)
