# AnixOps 规划差距与实施清单

Last updated: 2026-05-06

## 目的

这份文档不是重复长期规划，而是把当前仓库和规划之间的差距拆成可执行 backlog。

判断依据：

- 当前执行目标与线上状态：`AGENT.md`
- 当前验收文档：`docs/current-state-audit.md`
- API 长期规划：`docs/long-term-api-plan.md`
- 用户后台与合规规划：`docs/user-console-compliance-roadmap.md`
- 产品流程原始目标：`流程.md`

## 总结判断

当前仓库不是“从 0 到 1 缺基础设施”，而是“底层能力已经铺出大半，产品化层明显滞后”。

可以把现状分成两层：

- 已基本完成：自托管部署主路径、远端 cutover、管理员排障链路、探针/钱包/计费/安装/容量这些后端基础能力。
- 明显缺口：`/console` 用户后台、邀请返利、虚拟币充值、合规模式购买侧贯通、链上锚定。

因此，下一阶段最合理的推进方式不是继续堆底层脚本，而是优先补“账户层”和“产品闭环”。

## 状态分级

状态定义：

- `Done`：代码和路由已存在，能力基本闭环。
- `Partial`：底层或一半能力已在，但未形成完整产品功能。
- `Missing`：规划存在，但仓库中未见对应实现。
- `Decision Needed`：继续实施前需要先确认产品边界。

## 差距总表

| 工作项 | 当前状态 | 现有依据 | 主要缺口 | 建议优先级 |
|---|---|---|---|---|
| 自托管生产主路径 | Done | `AGENT.md`, `docs/current-state-audit.md`, `docs/production-runbook.md` | 主要是文档同步，不是功能缺口 | P0 |
| Catalog / Quote / Progress / Billing / Probes API | Done | `server/src/index.ts`, `server/src/catalog.ts`, `server/src/rental-progress.ts`, `server/src/rental-billing.ts`, `server/src/probe-observability.ts` | 还没被用户后台聚合消费 | P0 |
| 钱包账本 / Stripe 充值 / Billing Tick / Wallet Rental | Done | `server/src/index.ts`, `server/src/wallet.ts`, `server/src/wallet-ledger.ts`, `server/src/billing-ticks.ts`, `server/src/db/schema.ts` | 产品页和运营视图不足 | P0 |
| Provision 尝试记录 / Mainland Probe / Cloud-init / 安全端口策略 | Done | `provision-server/src/provision.ts`, `provision-server/src/probe.ts`, `scripts/vless-reality.sh`, `scripts/hysteria2.sh` | 合规模式仍未产品化 | P1 |
| Admin providers / metrics / freeze / refund | Done | `server/src/index.ts`, `server/src/admin-providers.ts`, `server/src/admin-metrics.ts`, `server/src/admin-users.ts` | 用户侧没有对应账户视图 | P1 |
| `/console` 用户后台 | Done | `docs/user-console-compliance-roadmap.md`, `server/src/index.ts`, `server/src/referrals.ts`, `web/components/console/ConsoleHub.tsx`, `app/console/*`, `web/app/console/referrals/page.tsx` | referrals 已落地，MVP 主体与邀请中心闭环完成 | P0 |
| CDK 余额化产品化 | Done | `server/src/index.ts`, `server/src/redeem-codes.ts`, `server/src/lib/redeem-codes.ts`, `web/app/admin/page.tsx`, `web/components/console/ConsoleHub.tsx` | 旧 `/api/redeem` 兼容路径仍保留，但主产品流已统一到钱包余额入账 | P1 |
| 统一探测中心 | Done | `probe_nodes` / `probe_runs` / `probe_results`、结构化 probe API、用户侧探测摘要 | 统一了 `source/trigger/operator_user_id/policy_snapshot` 语义；后续剩余的是大陆多点覆盖和更严格的自动重试策略 | P1 |
| 邀请返余额 | Done | `server/src/db/schema.ts`, `server/src/index.ts`, `server/src/referrals.ts`, `web/components/console/ConsoleHub.tsx`, `web/app/console/referrals/page.tsx`, `app/console/referrals/page.tsx`, `server/__tests__/referrals.test.ts` | `invite_codes` / `invite_bindings` / `referral_rewards` 已落地，邀请中心和返佣账本闭环可用 | P1 |
| 虚拟币充值 | Missing | 只在规划文档出现 | 无 `crypto_topups` 和 provider 抽象 | P2 |
| 合规模式控制面 | Partial | `server/src/compliance.ts`, `server/src/index.ts`, `server/src/db/schema.ts`, `provision-server/src/provision.ts`, `scripts/vless-reality.sh`, `scripts/hysteria2.sh` | 后端核心和 strict binding 已有；还缺公共 profile 列表、购买链路显式选择、Stripe / redeem 入口贯穿、策略命中统计和用户侧展示 | P2 |
| 结构化审计账本 | Done | `server/src/audit-events.ts`, `server/src/index.ts`, `server/src/db/schema.ts`, `web/app/admin/page.tsx` | `audit_log` 仍保留作兼容层；链上锚定部分仍未落地 | P2 |
| 链上锚定 | Partial | `server/src/audit-anchor.ts`, `server/src/audit-anchor-crypto.ts`, `server/src/scripts/audit-anchor.ts`, `server/package.json`, `package.json`, `server/src/db/schema.ts` | 本地批次、root 计算、CLI、verify 和 receipt persistence 已有；真正的链上提交仍待链钱包/链路决策 | P3 |
| 文档状态同步 | Done | `docs/current-state-audit.md`, `docs/long-term-api-plan.md`, `docs/user-console-compliance-roadmap.md` | 2026-05-06 基线已对齐；后续只需随实现持续维护 | P0 |

## 立即要做的 P0

### 1. 补 `/console` 用户后台 MVP

目标：

- 把已有租用、钱包、账单、探测能力包装成“账户后台”，而不是继续围绕单次租用页零散扩展。

后端任务：

- 新增 `GET /api/console/overview`
- 新增 `GET /api/console/nodes`
- 新增 `GET /api/console/wallet`
- 新增 `GET /api/console/audit`
- 实现 `GET /api/console/referrals`，返回邀请码、绑定状态和返佣历史

建议落点：

- `server/src/index.ts`
- 新增 `server/src/console-overview.ts`
- 新增 `server/src/console-nodes.ts`
- 新增 `server/src/console-wallet.ts`
- 新增 `server/src/console-audit.ts`

前端任务：

- 新增 `web/app/console/layout.tsx`
- 新增 `web/app/console/page.tsx`
- 新增 `web/app/console/nodes/page.tsx`
- 新增 `web/app/console/wallet/page.tsx`
- 新增 `web/app/console/audit/page.tsx`
- 复用现有同源代理 `web/app/api/[...path]/route.ts`，不再单独新增 `web/app/api/console/*`

复用现有能力：

- `/api/wallet`
- `/api/wallet/ledger`
- `/api/rental/:id/progress`
- `/api/rental/:id/probes`
- `/api/rental/:id/billing`

验收：

- 登录用户进入 `/console` 能看到余额、运行中节点、即将到期节点、最近充值、最近扣费
- 节点页能看到协议、IP、状态、剩余时长、最近探测摘要、续费/销毁入口
- 钱包页能看到余额、最近 topups、最近 ledger entries
- 页面具备 loading、error、empty、retry 状态
- 前端不直接 fan-out 调十几个底层接口，主要通过聚合接口读取

### 2. 清洗文档状态

目标：

- 把“规划”和“已落地能力”重新对齐，避免开发时反复误判。

任务：

- 更新 `docs/current-state-audit.md` 到 2026-05-06 实际基线
- 清理 `docs/long-term-api-plan.md` 中“已落地”与底部 checklist 的冲突表述
- 在 `docs/user-console-compliance-roadmap.md` 明确哪些前置能力已具备，哪些仍是 Phase backlog
- 约定统一状态字段：`Done` / `Partial` / `Missing` / `Decision Needed`

验收：

- 任意一名开发者只读文档就能分辨“已完成能力”和“下一步工作”

## 接下来的 P1

### 3. 把 CDK 正式做成余额产品

当前判断：

- 钱包账本、钱包充值、钱包兑换接口已经具备基础。
- 2026-05-06：`redeem_codes` 已支持 `duration grant` / `balance credit` 双模式；后台发码、钱包兑换、账本入账和审计链路已经打通。

任务：

- [x] 扩展 `redeem_codes`，支持区分 `duration grant` 和 `balance credit`
- [x] 后台发码接口支持余额型 CDK
- [x] 用户后台钱包页支持 CDK 直接充值余额
- [x] 所有 CDK 入账统一写 `wallet_ledger`
- [x] 保留旧 `/api/redeem` 的兼容路径，但不再作为主产品流

建议落点：

- `server/src/db/schema.ts`
- `server/src/index.ts`
- `server/src/redeem-codes.ts`
- `server/src/lib/redeem-codes.ts`
- `web/app/admin/*`
- `web/components/console/ConsoleHub.tsx`

验收：

- [x] 管理员可以发余额型 CDK
- [x] 用户输入 CDK 后余额增加，账本有记录，后台审计可追溯
- [x] 旧 `/api/redeem` / `/api/redeem/validate` 对余额码返回兼容提示，不再误走免费租用主路径

### 4. 统一探测中心

当前判断：

- 结构化 `probe_nodes` / `probe_runs` / `probe_results`、internal probe endpoints、管理端 probe 列表和用户侧节点摘要已经落地。
- `source` / `trigger` / `operator_user_id` / `policy_snapshot` 已经统一进 run 语义，交付探测和手工探测可以在同一运营视图中区分。
- 现在剩下的是继续补强大陆多点覆盖、投票阈值和自动重试的策略收口。

任务：

- [x] 给 `probe_runs` 增加 `source`
- [x] 给 `probe_runs` 增加 `trigger`
- [x] 给 `probe_runs` 增加 `operator_user_id`
- [x] 给 `probe_runs` 增加 `policy_snapshot`
- [x] 管理端 probe 列表支持按来源、结果、节点、租用单过滤
- [x] 用户后台节点详情展示探测历史摘要

验收：

- [x] 管理员能区分 delivery probe 和 manual probe
- [x] 用户能看到自己节点最近几次探测结果摘要

建议落点：

- `server/src/db/schema.ts`
- `server/src/probe-observability.ts`
- `server/src/probe-service.ts`
- `web/app/admin/*`
- `web/app/console/nodes/*`

验收：

- 管理员能区分 delivery probe 和 manual probe
- 用户能看到自己节点最近几次探测结果摘要

### 5. 邀请返余额

2026-05-06 状态：Done

已固定规则：

- 返利触发点为首充和首单，任一首个 qualifying event 只发一次奖励。
- 奖励默认立即结算；邀请人被冻结时进入 held，解冻后再补结。
- 风控命中后冻结奖励，不改写原始邀请或消费事件。

交付：

- [x] 新增 `invite_codes`
- [x] 新增 `invite_bindings`
- [x] 新增 `referral_rewards`
- [x] 新增绑定邀请码和查看邀请数据的用户接口
- [x] 返利入 `wallet_ledger`
- [x] 奖励事件入审计流

建议落点：

- `server/src/db/schema.ts`
- `server/src/index.ts`
- `server/src/referrals.ts`
- `web/app/console/referrals/*`

验收：

- [x] 用户拥有个人邀请码
- [x] 新用户首次绑定后不可改绑
- [x] 首次充值或首次消费达成后，邀请奖励按规则入账

## 之后的 P2

### 6. 合规模式控制面

当前判断：

- 后端核心已经开始产品化：`compliance_profiles`、租用单绑定/释放、`strict` compliance binding、`complianceMode` 传递和协议门控都已落地。
- 现在缺的是购买面贯穿：公开 profile 列表、RentalWizard 选择、Stripe checkout/webhook 贯穿、redeem 入口前端透传，以及用户/管理端的策略版本展示。
- 安装脚本仍然以端口级封禁为主，白名单规则和命中统计还需要继续收口。

前置决策：

- 是否正式推出“合规模式”
- 合规模式是否下线 Hysteria2
- 合规模式是否只允许 `vless-reality`

任务：

- [x] 新增 `compliance_profiles`
- [x] 租用单绑定策略版本
- [x] Provision 侧接收 `complianceMode` 并做协议门控
- [x] 管理端可创建、更新和查看策略
- [ ] 新增公开 `GET /api/compliance-profiles`
- [ ] RentalWizard 暴露策略选择并把 `complianceProfileId` 传到 Stripe checkout
- [ ] `POST /api/payment/checkout` 与 webhook 创建租用时贯穿 `complianceProfileId`
- [ ] Redeem 入口前端透传 `complianceProfileId`
- [ ] 记录策略拒绝命中统计并在用户/管理端展示
- [ ] 统一策略版本与节点应用状态展示

建议落点：

- `server/src/db/schema.ts`
- `scripts/vless-reality.sh`
- `scripts/hysteria2.sh`
- `server/src/index.ts`
- `web/app/admin/*`

验收：

- 标准模式和合规模式有明确区分
- 租用详情可追溯“创建时使用的是哪版策略”
- 用户能在购买入口明确选择或识别合规档位
- 购买链路、租用绑定和 provision 侧使用同一版策略标识

### 7. 虚拟币充值

当前判断：

- 钱包账本已具备，可以承接新的资金入口。
- 但链上入账、对账、异常处理完全未做。

任务：

- 新增 `crypto_topups`
- 实现收款地址分配
- 实现链上确认回调
- 法币折算后入 `wallet_ledger`
- 处理短款、超时、重复打款、重复回调

建议策略：

- 先做单链路，例如 `USDT` on `TRON` 或 `Polygon`
- 先不要同时开放多链多币种

验收：

- 一笔链上充值可以从订单创建到确认入账完整闭环
- 幂等处理稳定，不重复加余额

### 8. 结构化审计账本

当前判断：

- `audit_events`、request trace id 和 hash chain 已落地；`audit_log` 继续作为兼容层。

任务：

- [x] 新增 `audit_events`
- [x] 每个关键动作写结构化事件
- [x] 增加 request trace id
- [x] 增加事件 hash chain
- [x] 保留 `audit_log` 一段时间作为兼容层
- [x] `audit_anchor_batches` 已补上，后续继续补链上回执和校验闭环

建议落点：

- `server/src/db/schema.ts`
- `server/src/index.ts`
- 新增 `server/src/audit-events.ts`

验收：

- 登录、充值、兑换、返利、开机、探测、销毁、退款、冻结、管理员操作都进入结构化审计

## 最后的 P3

### 9. 链上锚定

当前判断：

- 本地批次、验证脚手架和 receipt persistence 已落地，但真正的链上提交还没有接入。

任务：

- [x] 新增 `audit_anchor_batches`
- [x] 生成批次 `merkle_root`
- [x] 增加 anchor cron / worker 入口
- [x] 保存链上交易回执
- [x] 提供 verify script

验收：

- 指定日期区间的审计批次能验证 root 和链上回执一致

## 建议执行顺序

建议按下面顺序推进：

1. `/console` 用户后台 MVP
2. 文档状态清洗
3. CDK 余额化
4. 统一探测中心
5. 邀请返余额
6. 合规模式控制面
7. 虚拟币充值
8. 结构化审计账本
9. 链上锚定

## 需要先确认的产品决策

这些问题不影响先做 `/console`，但会阻塞后续 Phase：

1. 是否正式推出“合规模式”
2. 合规模式下是否保留 Hysteria2
3. CDK 是否彻底转成余额产品，还是保留一部分时长码
4. 邀请返利规则以首充还是首单为准
5. 虚拟币首发只做哪一条链

## 最小可开工集合

如果只选一条主线马上开工，建议就是：

- 先做 `/api/console/*`
- 再做 `web/app/console/*`
- 同步把 `docs/current-state-audit.md` 和 `docs/long-term-api-plan.md` 状态修正

原因：

- 这条线对现有底层能力复用最多
- 对用户可见价值最大
- 不依赖邀请码、虚拟币、审计上链这些更后置的决策
## Progress Update

2026-05-06

- Checklist item `1. /console MVP` is now implemented.
- Backend aggregation routes are live:
  - `GET /api/console/overview`
  - `GET /api/console/nodes`
  - `GET /api/console/wallet`
  - `GET /api/console/audit`
- `GET /api/console/referrals` live
- Frontend routes are wired into the active Next app:
  - `/console`
  - `/console/nodes`
  - `/console/wallet`
  - `/console/audit`
  - `/console/referrals`
- Verification completed:
  - `vitest` passed for console helpers plus related wallet/rental/probe suites
  - `npm run lint` passed
  - `npm run build` passed and included the `/console` routes in the app output

2026-05-06

- Checklist item `2. 文档状态清洗` is now implemented.
- `docs/current-state-audit.md` now reflects the 2026-05-06 repository baseline and includes the `/console` evidence.
- `docs/long-term-api-plan.md` now separates delivered foundations from the still-open gaps, instead of leaving wallet/billing/cloud-init items marked as missing.
- `docs/user-console-compliance-roadmap.md` now records that Phase 1 `/console` MVP is complete, and that the remaining account-layer gaps moved to referrals / CDK balance / unified probe semantics.

2026-05-06

- Checklist item `3. CDK 余额化` is now implemented.
- `redeem_codes` now supports both `duration grant` and `balance credit`, with runtime schema backfill via `ensureRedeemCodeSchema()`.
- `POST /api/admin/redeem-codes` and `PATCH /api/admin/redeem-codes/:id` now support balance-style CDKs in addition to legacy duration codes.
- `POST /api/wallet/redeem` now credits both balance CDKs and legacy duration CDKs into `wallet_ledger`, with audit coverage.
- Legacy `/api/redeem` and `/api/redeem/validate` remain for compatibility, but balance CDKs are explicitly redirected to the wallet flow.
- Verification completed:
  - `npx vitest run server/__tests__/redeem-codes.test.ts server/__tests__/wallet.test.ts server/__tests__/console-views.test.ts server/__tests__/rental-progress.test.ts server/__tests__/probe-observability.test.ts server/__tests__/rental-billing.test.ts`
  - `npm run lint`
  - `npm run build`

2026-05-06

- Checklist item `4. 统一探测中心` is now implemented.
- `probe_runs` now records `source`, `trigger`, `operator_user_id`, and `policy_snapshot`, and the admin/user probe views read structured rows first with stage-log fallback.
- `web/components/admin/ProbeRunsPanel.tsx` and `web/components/console/ConsoleHub.tsx` now expose the unified probe center to operators and end users.
- Verification completed:
  - `npx vitest run server/__tests__/probe-observability.test.ts server/__tests__/console-views.test.ts provision-server/src/__tests__/probe.test.ts`
  - `npm run lint`
  - `npm run build`

2026-05-06

- Checklist item `8. 结构化审计账本` is now implemented.
- `server/src/audit-events.ts` now provides structured event writes, request id propagation, and a hash-chain-backed append path.
- `server/src/index.ts` and `web/app/admin/page.tsx` now surface `recentStructuredAuditEntries` in the admin overview and rental detail views.
- Verification completed:
  - `npm run lint`
  - `npm run build`
  - `cd server && npm run build`
  - `npm test -- server/__tests__/console-views.test.ts server/__tests__/wallet.test.ts server/__tests__/rental-progress.test.ts server/__tests__/probe-observability.test.ts server/__tests__/rental-billing.test.ts`
