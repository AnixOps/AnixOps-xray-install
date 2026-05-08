# AGENT.md

## 目的

这是一份给后续开发者和 AI Agent 使用的仓库启动简报。Agent 只读这一份时，也应该能知道：

- 当前产品目标是什么。
- 哪些决策已经定了。
- 下一步优先做什么。
- 做完后如何自查、测试、提交和部署。

当前仓库已经把基础能力铺开，后续工作主要集中在未完成项的收口、测试链联调、正式版发布和少量产品化补齐。

## 当前目标

短期目标：把测试服保持为可验收闭环，同时把正式版 V1 收口成可发布快照。

闭环定义：

1. 内部白名单用户可以在测试服登录。
2. 测试服仍可通过余额充值获得站内余额，并保持历史 rail 可回归。
3. 租用节点时只看到 `余额支付` 和 `兑换码` 两种付款模式。
4. 余额支付可以创建 rental、扣账、进入 provision 流程。
5. 兑换码可以创建 rental、进入 provision 流程。
6. 测试服页面明确显示测试版标注。
7. 正式版 V1 通过 `NEXT_PUBLIC_RELEASE_PROFILE=formal` 收口到 `CDK`，只保留 `wallet` 余额直充型和 `duration` 单次型。
8. 管理端和支付记录能区分充值、余额扣费、兑换码、历史直接支付记录。

中期目标：把测试链能力迁移成可生产化方案。

生产化定义：

1. 明确生产链、资产、汇率源、确认数和托管方式。
2. 私钥不进入 git、前端、日志和示例文件。
3. 充值、扣费、退款和审计锚定都有可追踪流水。
4. 远端部署、健康检查、回滚和审计恢复流程可重复执行。

## 事实来源

以下文档是当前状态的主要来源，优先于旧印象和过期说明：

- [docs/current-state-audit.md](docs/current-state-audit.md)
- [docs/implementation-gap-checklist.md](docs/implementation-gap-checklist.md)
- [docs/manual-input-checklist.md](docs/manual-input-checklist.md)
- [docs/payment-balance-model.md](docs/payment-balance-model.md)
- [docs/production-release-plan.md](docs/production-release-plan.md)
- [docs/frontend-redesign-plan.md](docs/frontend-redesign-plan.md)
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
| 测试服余额充值入口 | `Stripe`、`钱包支付`、`X402` |
| 正式版充值入口 | `CDK wallet`、`CDK duration` |
| 正式版模式开关 | `NEXT_PUBLIC_RELEASE_PROFILE=formal` |
| 生产云厂商默认 | `Vultr` |
| 可切换云厂商 | `DigitalOcean`、`AWS` |
| 自托管调度 | `scheduler` 容器承接 |

## 已定产品决策

| 决策 | 当前结论 |
|---|---|
| 租用支付 | 租用页只保留 `余额支付` 和 `兑换码` |
| 余额充值 | `Stripe`、钱包支付、`X402` 都属于余额充值入口，但钱包支付和 `X402` 必须保留独立 rail 语义 |
| 测试服链路 | 默认使用 `Base Sepolia + mock USDT` |
| 测试服开放范围 | 链上相关能力只对白名单邮箱开放 |
| 测试服标注 | 所有非正式版本站点顶部必须显示测试版提示 |
| 前端大改组件库 | 主线定为 `shadcn/ui + Radix UI + TanStack Table + lucide-react + sonner`，细节见 `docs/frontend-redesign-plan.md` |
| 云厂商 | 保留 `Vultr`、`DigitalOcean`、`AWS` 三家，当前默认 `Vultr` |
| 私钥用途 | 充值钱包私钥和审计锚定私钥必须分离 |
| 支付详情页 | 支付记录里的 `rental_id` 会跳到 `/payments/[rentalId]`，页面展示节点状态和订阅链接 |
| 正式版首发充值 | 只保留 `CDK` 兑换码通道，`Stripe` 未申请前不作为生产可见入口；`CDK` 分 `wallet` 余额直充型和 `duration` 单次型 |
| 正式版发布方式 | 用 tag 发布正式版快照，不单独长期维护 `production` 分支 |
| Worker API | `web/workers/index.ts` 仍存在，改动核心 API 时要决定是否同步或废弃 |

## 当前仍待推进

说明：P0 测试服充值闭环已在 2026-05-08 的 `scripts/recharge-smoke.js` live run 中验收完成，下面只保留剩余工作。

| 优先级 | 工作 | 目标状态 | 验收标准 |
|---|---|---|---|
| P1 | 审计 anchor 测试链闭环 | 管理端已展示 anchor batch、`txHash`、receipt summary、recovery hint，并支持 verify；已补 smoke 脚本 | 仍需测试链闭环、`receipt` 恢复和失败恢复 SOP 的实跑验证 |
| P1 | 支付和充值后台展示 | 管理端能区分充值、余额扣费、兑换码和历史直接支付 | 后台列表显示来源和状态，不混淆 rental payment 与 topup |
| P2 | 真实链上充值生产化 | 明确生产链、资产、provider、确认监听、汇率源和对账 | 写入生产方案并完成小额实测 |
| P2 | 合规统计展示 | 管理端和控制台已展示 profile、blocked protocol、reject stats 和 sync coverage | 仍可继续补导出、告警和更细的用户端统计 |
| P2 | 合规产品边界 | 明确合规模式是正式产品线还是安全增强 profile | 文档和 UI 口径一致 |
| P2 | Worker API 去留 | 决定 `web/workers/index.ts` 是继续维护还是废弃 | 若保留，核心 API 改动必须同步；若废弃，移除部署入口 |

## 当前推荐实施顺序

1. 先把正式版 V1 的 tag 发布和远端部署跑通，默认用 `NEXT_PUBLIC_RELEASE_PROFILE=formal` 验证 CDK 两种兑换码、节点详情页和支付记录跳转。
2. 跑测试服充值闭环：先用 `node scripts/recharge-smoke.js` 验证充值、入账和余额租用，再补兑换码租用、支付记录展示。
3. 再处理审计 anchor 测试链闭环和生产主网决策，优先跑 `node scripts/audit-anchor-smoke.js --confirmation-mode synthetic`。
4. 补齐支付和充值后台展示，让充值、余额扣费、兑换码和历史直接支付不混淆。
5. 最后再决定 Worker API 去留，避免重复维护两套核心入口。

## 敏感信息与安全边界

- 不要读取、打印或复述 `.local-secrets.env` 的内容。
- 不要提交 `polugon-test.txt` 或任何包含测试钱包私钥的临时文件。
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
- 如果产品决策改变，必须同步更新 `AGENT.md` 和对应 docs。
- 如果修改支付、充值、租用或账本逻辑，必须检查 `server/src/index.ts`、`server/src/db/*`、`web/components/rental/*`、`web/components/console/*`、`web/workers/*` 是否需要同步。

## 审阅清单

提交前至少做这些检查：

1. `git status --short`：确认没有把 secret、临时钱包文件、`.env*` 文件放进暂存区。
2. `npm run security:scan`：确认没有明显 secret 泄露。
3. `npm run lint`：确认类型检查通过。
4. `npm test`：确认测试通过。
5. `npm run build`：确认前端构建通过。
6. `npm --prefix server run build`：如果改了 `server/`，确认后端构建通过。
7. 支付/余额相关改动必须人工走一遍：余额充值、余额租用、兑换码租用、余额不足提示。

如果因环境限制无法运行某项检查，最终回复必须明确说明未运行的项目和原因。

## 完成定义

一个任务只有同时满足这些条件才算完成：

- 代码或文档已经按当前目标落地。
- 相关测试或构建已经运行，或明确说明无法运行。
- 相关 docs 和 `AGENT.md` 已同步更新。
- 没有提交 secret、私钥、`.local-secrets.env`、`polugon-test.txt`。
- 如果涉及远端服务，已经重新部署或明确说明还未部署。

## 提交和部署约定

- 提交前先跑安全扫描。
- 不要把无关工作区改动一起提交。
- 远端自托管部署优先使用：

```bash
node scripts/selfhosted-deploy.js --replace-live
```

- 正式版发布时，`NEXT_PUBLIC_RELEASE_PROFILE=formal` 必须同时出现在 `web` 的 build arg 和运行时环境里，否则前端仍会按测试版渲染。

- 远端状态和健康检查优先使用：

```bash
node scripts/remote-ops.js status
node scripts/remote-ops.js health --strict
```

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

如果任务和前端大改、UI 组件库、控制台布局、管理后台布局或视觉系统有关，先看：

- [docs/frontend-redesign-plan.md](docs/frontend-redesign-plan.md)

如果任务和正式版发布、充值渠道配置、CDK 兑换码双版本有关，先看：

- [docs/production-release-plan.md](docs/production-release-plan.md)
- [docs/REDEEM_CODES.md](docs/REDEEM_CODES.md)

如果任务和产品边界、未完成项或路线图有关，先看：

- [docs/current-state-audit.md](docs/current-state-audit.md)
- [docs/implementation-gap-checklist.md](docs/implementation-gap-checklist.md)
- [docs/long-term-api-plan.md](docs/long-term-api-plan.md)
- [docs/user-console-compliance-roadmap.md](docs/user-console-compliance-roadmap.md)
