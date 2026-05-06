# AnixOps 长期 API 规划

Last updated: 2026-05-06

本规划依据仓库根目录的 `流程.md` 制定，并结合当前代码中的自托管 Node API、Next.js API 路由、Provision Server、数据库模型和云厂商适配器。

规划目标不是一次性重写系统，而是把 `流程.md` 里的产品能力拆成可持续演进的 API 边界：探针自愈、云厂商调度、节点配置、钱包计费、自动销毁、管理员可观测性。

## 实现进度

2026-05-06 第一批落地：

- `GET /api/catalog/regions`: 返回当前运行环境配置的 provider/region/protocol catalog。
- `GET /api/catalog/plans`: 返回当前运行环境配置的 plan 和统一价格表。
- `POST /api/rental/quote`: 返回 15 分钟有效的 stateless 租用报价，兼容当前 1/6/12/24 小时时长。
- `GET /api/rental/:id/progress`: 聚合当前租用状态、剩余时间和 `audit_log` 中的 `provision_stage`，输出前端可轮询的 progress payload。
- 价格表已抽到 `server/src/pricing.ts`，catalog 构建已抽到 `server/src/catalog.ts`，进度聚合已抽到 `server/src/rental-progress.ts`。

2026-05-06 第二批落地：

- `GET /api/wallet`: 返回兼容钱包摘要，当前数据源为 `users.balance`。
- `GET /api/wallet/ledger`: 返回兼容钱包流水，当前数据源为历史 `payments`；后续 Phase 3 再切到真正的 `wallet_ledger` 表。
- 钱包兼容视图已抽到 `server/src/wallet.ts`。

2026-05-06 第三批落地：

- `GET /api/rental/:id/billing`: 返回兼容租用账单摘要，当前数据源为租用单和历史 `payments`，响应里保留 `ticks: []` 作为后续滴答计费接入点。
- 租用账单兼容视图已抽到 `server/src/rental-billing.ts`。

2026-05-06 第四批落地：

- Provision Server 增加 `stage2.5` 交付前连通性探针钩子，位于 `provision-server/src/probe.ts`。
- 默认不改变生产行为；设置 `PROBE_SERVICE_URL` 后走外部 Probe Service，或设置 `PROBE_ENABLED=true` 且不配置 service URL 时走本地 TCP probe fallback。
- 探针通过后才返回配置；探针失败会先删除当前 VPS，再让现有 provision job 失败并交给队列重试下一台。
- `.env.example` 与 `.env.selfhosted.example` 已补充 probe 配置项。

2026-05-06 第五批落地：

- `GET /api/rental/:id/probes`: 基于 `audit_log` 中的 `stage2.5-*` 记录返回当前租用的探针摘要、推断出的 probe run 列表和事件时间线。
- `GET /api/admin/probes/runs`: 管理员按最近 stage log 查看探针运行列表，可按 `rentalId`、`status`、`decision` 过滤。
- `GET /api/admin/probes/runs/:id`: 管理员按外部 probeRunId 查看单次探针详情、关联租用和完整事件。
- `GET /api/admin/rentals/:id`: 管理员租用详情已补充 `probeSummary` 和 `probeRuns`，与现有 `stageLogs` 共用同一套审计日志兼容视图。
- 探针可观测性已经切到结构化 `probe_runs` / `probe_results` 表，stage-log 兼容视图保留作 fallback。
- `passRatio` 等探针指标已从敏感字段误脱敏规则中排除，真实 token/secret/password/key 仍会脱敏。

2026-05-06 第六批落地：

- 引入 `provision_attempts` 表和运行时 `CREATE TABLE IF NOT EXISTS` 兼容路径，用于现有自托管数据库逐步补齐结构化尝试记录。
- Core provision worker 现在按 BullMQ retry 元数据生成稳定 `attemptId`、`attemptNo`、`maxAttempts`，并在每次尝试开始、成功、失败、失败后已销毁或被废弃时写入 `provision_attempts` 和 `audit_log`。
- Core 调用 Provision Server 的 `/api/provision` 时会传递 `attemptId`、`attemptNo`、`maxAttempts`；`/api/destroy` 已预留 `attemptId` 和 `reason`。
- Provision Server 的 stage log 和外部 Probe Service 请求已带上 attempt 元数据，`GET /api/rental/:id/progress` 能在后续 stage 不重复 attempt 字段时仍保留当前尝试编号。
- `GET /api/admin/rentals/:id` 已补充 `attempts`，管理员可以把 stage logs、probe runs 和每次开机尝试对应起来。
- maxAttempts 耗尽时 Core 会把仍处于 `provisioning` 的租用置为 `failed`；旧的过期 provisioning 和人工 release 仍走兼容释放路径。

2026-05-06 第七批落地：

- 引入 `wallet_ledger` 和 `topups` 表，并提供运行时 `CREATE TABLE IF NOT EXISTS` 兼容路径。
- `GET /api/wallet` 现在优先读取 ledger-derived balance；没有 ledger 的老用户仍回退到 `users.balance`。
- `GET /api/wallet/ledger` 现在优先返回 `wallet_ledger`；没有 ledger entry 时仍回退到历史 `payments` 兼容视图。
- `POST /api/wallet/topups/checkout` 创建 Stripe 钱包充值 checkout 和 pending topup。
- `GET /api/wallet/topups/:id` 返回当前用户自己的充值订单状态。
- `POST /api/wallet/topups/webhook` 和旧 `/api/payment/webhook` 都能处理 `wallet_topup` checkout session，并用 `stripe:{sessionId}:topup` idempotency key 写入钱包流水、更新 `users.balance` 缓存。
- `/api/rental/session/:sessionId` 已兼容 `topup:` 缓存值，方便旧成功页查询充值结果。

2026-05-06 第八批落地：

- 引入 `billing_ticks` 表和运行时 `CREATE TABLE IF NOT EXISTS` 兼容路径。
- 新增 `POST /internal/billing/tick`，使用 `X-API-Secret` 调用，仅扫描 `payment_method='wallet'` 的 active rentals，避免改变现有 Stripe/兑换码预付租用行为。
- billing tick 按 `price_per_hour` 和上次 tick 的 `period_end` 计算分摊扣费，使用 `billing:{rentalId}:{periodStart}:{periodEnd}` 幂等键写入负数 `wallet_ledger` 和 `billing_ticks`。
- 当钱包余额不足以支付本 tick 时，租用进入 `destroying` 并排入 destroy job，同时写入 `billing_low_balance_destroy` 审计。
- 当前还没有把用户创建租用切到 `paymentMethod='wallet'`；tick 路径已先落地为后续 wallet rental 的计费执行层。

2026-05-06 第九批落地：

- `POST /api/rental` 现在接受 `paymentMethod='wallet'`，会读取 ledger-derived balance 并要求至少覆盖约 5 分钟的首个 tick 风险。
- wallet rental 不再写 legacy `payments`，而是以 `payment_method='wallet'` 创建租用，后续由 `/internal/billing/tick` 写负数 `wallet_ledger` 和 `billing_ticks`。
- 既有 `paymentMethod='stripe'` 直接租用流程保持兼容，仍写 `payments` 并返回 `billingMode='legacy_direct_payment'`。

2026-05-06 第十批落地：

- 新增 `POST /api/wallet/redeem`，把未使用、未过期的兑换码原子 claim 后转换为钱包余额。
- 钱包兑换码现已支持 `duration grant` / `balance credit` 双模式；旧时长码按已有价格表折算 credit，价格表没有覆盖的时长按当前 24 小时档的 0.4 USD/h 估算。
- 钱包兑换写入 `wallet_ledger` 的 `redeem_code_credit`，使用 `redeem:{codeId}:{userId}` 幂等键，并更新 `users.balance` 缓存。
- 旧 `/api/redeem` 直接创建免费租用的流程仍保留兼容。

2026-05-06 第十一批落地：

- Provision provider contract 增加可选 `userData`，Vultr/DigitalOcean 映射为 `user_data`，AWS 映射为 base64 `UserData`。
- Provision Server 默认进入 `cloud-init-preferred` 安装模式，可通过 `INSTALL_MODE=ssh` 或 `PROVISION_INSTALL_MODE=ssh` 回退到纯 SSH。
- VLESS Reality / Hysteria2 的安装参数会在创建 VPS 前生成，cloud-init 和 SSH fallback 共用同一组凭据，避免 fallback 后配置不一致。
- cloud-init 会写入安装脚本并在开机阶段执行，输出保存在 `/root/anixops-install-output.env`，退出码保存在 `/root/anixops-install-exit-code`。
- SSH ready 后会最多等待约 60 秒读取 cloud-init 安装结果；成功则直接解析配置，失败或超时则使用原 SSH 上传脚本路径 fallback。

2026-05-06 第十二批落地：

- VLESS Reality 伪装域名从 `DISGUISE_DOMAINS` / `REALITY_SERVER_NAMES` 读取逗号分隔池，并在每次安装计划中随机选择；默认仍为 `addons.mozilla.org`。
- VLESS install plan 会把选中的 `serverName` 传给脚本的 `--server-name`，返回给客户端的配置也使用同一个域名。
- `scripts/vless-reality.sh` 和 `scripts/hysteria2.sh` 增加 `apply_safety_policy`，通过 iptables/ip6tables 阻断出站 SMTP 25/465/587 与常见 BT 6881:6999、51413 端口。
- `.env.example` 和 `.env.selfhosted.example` 已补充 `INSTALL_MODE` 与 `DISGUISE_DOMAINS`。

2026-05-06 第十三批落地：

- 新增 `GET /api/admin/providers`，返回支持的 provider、当前 runtime catalog、凭据是否已配置（只返回布尔值，不返回密钥值）、安装模式、探针和伪装域名摘要。
- 新增 `POST /api/admin/providers/:provider/check`，Core API 会把 `{ provider, region, plan }` 转发给 Provision Server 的 provider check。
- `POST /api/admin/debug/provider-check` 兼容 `{ provider, region, plan }` 入参，保留旧调试入口。
- Provision Server 的 `POST /api/provider-check` 现在支持按请求体指定 provider/region/plan，并在 stage log meta 中记录本次检查目标。
- 新增 `PATCH /api/admin/providers/:provider/regions/:region`，先以 Redis override 方式支持 `available` / `degraded` / `disabled`；disabled region 会从公开 catalog 中过滤。
- 新增 `GET /api/admin/capacity`，聚合租用状态、provision attempts 与队列计数，当前以 runtime single-catalog 兼容视图呈现，后续再切到 rentals 持久化 provider/region/plan 后的真实容量矩阵。

2026-05-06 第十四批落地：

- 新增 `GET /api/admin/metrics/provisioning`，汇总租用状态、provision attempt 状态、队列计数和 attempt 成功率。
- 新增 `GET /api/admin/metrics/billing`，汇总 `wallet_ledger`、`billing_ticks`、`topups` 与 wallet 租用状态，输出充值、扣费和净额指标。
- 新增 `GET /api/admin/metrics/probes`，继续基于当前 stage log 兼容视图汇总 probe run 状态、决策、通过率、平均 passRatio 和平均 latency。
- 指标聚合逻辑已抽到 `server/src/admin-metrics.ts`，后续切换到结构化 probe/billing/provider 表时可以复用 API 形状。

2026-05-06 第十五批落地：

- `users` 增加 `is_frozen`、`frozen_at`、`freeze_reason`，并提供运行时 `ALTER TABLE` 兼容路径。
- 新增 `GET /api/admin/users/:id`，返回用户余额、freeze 状态、租用状态汇总和最近钱包流水。
- 新增 `GET /api/admin/users/:id/ledger`，管理员可查看指定用户的 `wallet_ledger`。
- 新增 `POST /api/admin/users/:id/credit`，使用必需的 `Idempotency-Key` 写入 `admin_credit` 钱包流水并更新余额缓存。
- 新增 `POST /api/admin/users/:id/freeze`，支持 freeze/unfreeze，并写入审计日志；后续还需要把 freeze 状态接入用户侧写操作拦截。

2026-05-06 第十六批落地：

- 新增 `POST /api/admin/rentals/:id/refund`，先支持 wallet 租用的 ledger-backed 退款。
- 管理员退款要求 `Idempotency-Key`，默认退还该租用尚未退还的 wallet 扣费，也支持指定不超过可退金额的部分退款。
- 退款写入 `wallet_ledger` 的 `admin_refund` 正数流水并审计；全额退款会把租用 `payment_status` 标记为 `refunded`。
- Stripe legacy 直接支付租用仍显式返回不支持，后续需要接入 Stripe Refund API 后再开放。

2026-05-06 第十七批落地：

- 新增结构化 `probe_nodes`、`probe_runs`、`probe_results` 表，并提供运行时 `CREATE TABLE IF NOT EXISTS` 兼容路径。
- 新增 `POST /internal/probes/runs` 与 `GET /internal/probes/runs/:id`，Provision Server 可在 `PROBE_SERVICE_URL` 指向 Core API 时创建并轮询 probe run。
- 新增 `POST /internal/probes/results`，探针节点可上报单节点结果，Core 会按 `minNodes/passRatio` 汇总 run 的 `status`、`decision`、`passRatio`。
- 新增 `POST /internal/probes/agents/heartbeat`，探针节点可注册/保活并拉取基础配置。
- 新增 `GET /api/admin/probes/nodes`，管理员可查看结构化探针节点健康；既有 probe run 管理视图仍保留 audit-log 兼容路径。

2026-05-06 第十八批落地：

- 管理员 freeze 状态开始接入用户侧写操作拦截。
- 冻结用户会被阻止创建 wallet topup、wallet redeem、新租用、旧兑换码租用、Stripe checkout、Stripe renewal 和恢复 paused rental。
- 暂停和销毁仍允许执行，避免冻结账号无法降低资源消耗。
- Webhook 已完成支付后的退款/补偿闭环仍需后续补齐，当前主要在创建支付会话前拦截。

2026-05-06 第十九批落地：

- `rentals` 增加 `provider`、`region`、`plan`、`attempt_count`、`last_stage`、`failed_reason`、`billing_started_at`、`billing_last_charged_at`、`destroy_reason`，并提供运行时 `ALTER TABLE` 兼容路径。
- 新建租用（wallet/Stripe direct/兑换码/admin debug）会写入当前 catalog placement；Stripe checkout metadata 也携带 provider/region/plan，webhook 创建租用时优先使用 metadata。
- Provision worker 会优先使用租用单持久化 placement 创建 `provision_attempts`，并把 attempt 编号回写到 `rentals.attempt_count`。
- `provision_stage` 写入审计时同步更新 `rentals.last_stage`，失败 stage 同步 `failed_reason`。
- `GET /api/admin/capacity` 现在优先使用持久化 placement bucket，只有缺少 placement 时才回退 runtime single-catalog 兼容视图。

2026-05-06 第二十批落地：

- 新增 `POST /internal/billing/rentals/:id/charge`，支持对单个 active wallet rental 按指定或默认 period 手动扣费，便于补偿和重试。
- 新增 `POST /internal/billing/rentals/:id/low-balance-destroy`，支持按阈值分钟检查余额并单租用排队销毁。
- 批量 `/internal/billing/tick` 和单租用扣费都会回写 `billing_started_at`、`billing_last_charged_at`；低余额销毁会写 `destroy_reason='low_balance'`。
- 单租用 charge 只负责扣费，余额不足时返回 `WALLET_BALANCE_LOW`，是否销毁交给独立 low-balance-destroy endpoint。

2026-05-06 状态同步：

- `/api/console/overview`、`/api/console/nodes`、`/api/console/wallet`、`/api/console/audit`、`/api/console/referrals` 已落地，邀请中心返回邀请码、绑定状态和返佣历史。
- `/console`、`/console/nodes`、`/console/wallet`、`/console/audit` 已接入当前 Next app，复用了既有的 `web/app/api/[...path]/route.ts` 同源代理。
- 这意味着“账户层聚合视图”已经不再是 gap；后续缺口主要集中在虚拟币充值、合规 profile 和链上提交。结构化审计已经落地，链上锚定目前只完成了本地批次与验证脚手架。

## 目标

长期目标是让用户按租节点时只感知一个稳定流程：

1. 用户登录、充值或兑换。
2. 用户选择协议、地区和时长。
3. API 立即返回租用单和可轮询状态。
4. 后台创建云主机，拿到 IP 后先做中国大陆链路探测。
5. 探测失败时自动销毁并重试，用户只看到“正在精选资源”。
6. 探测成功后安装协议、生成配置、进入 `active`。
7. 计费器按时间扣余额，余额不足或租期结束时自动销毁。
8. 管理端可看到每一步的状态、审计、失败原因和人工兜底动作。

成功标准：

- 每个长耗时动作都异步化，并有可查询的 stage log。
- 每个用户态 API 都有鉴权、限流、幂等和明确错误码。
- 每个云主机都有从创建到销毁的完整审计。
- 每个扣费动作都进入不可变账本，余额可由账本重算。
- 任何 IP 未通过大陆 TCP 443 探测前，不能交付配置给用户。
- 任何余额不足、租期结束、探针失败、安装失败，都要触发清理或释放租用记录。

## 现状

当前主要运行路径：

- Web: Next.js，同源 API 代理位于 `web/app/api`。
- Core API: Hono + Node，自托管入口位于 `server/src/index.ts`。
- Provision Server: Fastify，内部服务位于 `provision-server/src/server.ts`。
- Database: PostgreSQL，自托管 schema 位于 `server/src/db/migrations/001_initial.sql`。
- Queue/Cache: Redis + BullMQ。
- Cloud Provider: Vultr、DigitalOcean、AWS 适配器位于 `provision-server/src/providers`。

当前已具备：

- Magic link 登录、兼容注册/登录接口。
- Stripe 直接租用支付、续费、webhook。
- 钱包账本、Stripe topup、wallet rental、billing tick、admin refund/freeze 等资金与运营底座。
- 兑换码租用与 `POST /api/wallet/redeem` 钱包入账。
- 租用创建、查询、配置获取、暂停、恢复、销毁，以及 `GET /api/rental/:id/progress` / `billing` / `probes` 聚合视图。
- 管理端概览、搜索、兑换码管理、租用详情、强制销毁、释放卡住的 provisioning、providers / capacity / metrics / users / refund。
- Provision Server 内部创建 VPS、cloud-init 优先安装并保留 SSH fallback、随机伪装域名、安全端口封禁、销毁 VPS。
- `provision_attempts`、`wallet_ledger`、`topups`、`billing_ticks`、`probe_nodes` / `probe_runs` / `probe_results` 已建模并有运行时补齐路径；`probe_runs` 现在已统一 `source` / `trigger` / `operator_user_id` / `policy_snapshot`。
- `/api/console/*` 与 `/console` 用户后台已落地，覆盖 overview / nodes / wallet / audit / referrals，邀请中心已返回邀请码、绑定状态和返佣历史。
- Provision/destroy stage logs 写入 `audit_log`，定时任务自动销毁过期租用和释放过期未交付的 provisioning。

当前缺口：

- 探测中心已统一 `source` / `trigger` / `operator_user_id` / `policy_snapshot` 语义；后续还剩大陆多点覆盖、投票阈值调优和更严格的自动重试策略。
- 余额型 CDK 主路径已落地；剩余工作主要转向邀请返余额、虚拟币充值等新的钱包入账来源。
- 邀请码、邀请绑定、返余额模型与用户后台尚未实现。
- 虚拟币充值链路尚未实现。
- 合规模式已开始产品化：`compliance_profiles`、租用绑定、`strict` compliance binding 和 provision `complianceMode` 已落地；但公开选择、checkout/webhook 贯穿、命中统计和用户侧展示仍未收口。
- `audit_log` 继续作为兼容层；`audit_events`、request trace id 和 hash chain 已落地，本地批次/verify 和 receipt persistence 也已落地，但真正的链上提交仍未落地。

## 状态机

目标租用状态：

| 状态 | 含义 | 用户可见文案 | 进入条件 | 退出条件 |
|---|---|---|---|---|
| `pending_payment` | 等待充值/支付确认 | Waiting for payment | 创建 checkout 后 | webhook 或余额扣款成功 |
| `pending` | 已收款，等待队列处理 | Preparing | 租用单创建成功 | provision worker 开始 |
| `provisioning` | 正在向云厂商申请资源 | Allocating resource | 调用云厂商创建 VPS | 拿到公网 IP |
| `probing` | 正在大陆链路探测 | Testing network quality | 拿到 IP 和端口 | 探测通过或失败 |
| `configuring` | 正在安装协议和安全策略 | Configuring node | 探测通过 | 配置生成成功 |
| `active` | 已交付，可使用并计费 | Ready | 配置写入缓存和 DB | 到期、余额不足、用户销毁 |
| `destroying` | 正在清理并删除云资源 | Releasing resource | 销毁请求入队 | 删除成功或未找到 |
| `destroyed` | 云资源已删除 | Closed | destroy worker 成功 | 归档 |
| `expired` | 租期或 provisioning 已过期 | Expired | cron 或释放动作 | 归档 |
| `failed` | 交付失败且不可继续重试 | Failed | 重试耗尽 | 管理员处理或自动退款 |
| `released` | 未交付租用被释放 | Released | 无机器数据的卡单释放 | 归档 |

目标 stage 组：

| Stage | 范围 | 说明 |
|---|---|---|
| `stage0-*` | 订单、支付、钱包、队列 | quote、扣款、创建租用、入队 |
| `stage1-*` | 云厂商 | provider check、SSH key、创建 VPS、获取 IP |
| `stage2-*` | 基础连通性 | SSH/cloud-init readiness |
| `stage2.5-*` | 大陆探针 | TCP 443 探测、多探针投票、坏 IP 判定 |
| `stage3-*` | 节点配置 | 安装协议、防火墙、伪装域名、服务健康 |
| `stage4-*` | API 交付 | 缓存配置、DB active、前端可见配置 |
| `stage5-*` | 销毁 | 清理脚本、云厂商删除、缓存删除 |
| `stage6-*` | 计费 | tick 扣费、余额阈值、低余额销毁 |

## 数据模型规划

现有表：

| 表 | 当前用途 | 长期调整 |
|---|---|---|
| `users` | 用户邮箱、余额字段 | `balance` 只作为缓存余额，真实余额由 `wallet_ledger` 重算 |
| `rentals` | 租用单、协议、状态、IP、VPS ID、时长、价格 | 增加 `region`, `provider`, `plan`, `attempt_count`, `last_stage`, `failed_reason`, `billing_started_at`, `billing_last_charged_at`, `destroy_reason` |
| `payments` | Stripe/兑换码支付记录 | 拆出充值 `topups`，租用扣费写入 `wallet_ledger` |
| `redeem_codes` | 兑换码 | 保留，兑换码应入账为 wallet credit 或 free-rental grant |
| `audit_log` | 审计和 stage logs | 保留，新增结构化索引字段或拆分 `rental_events` |

新增表：

| 表 | 用途 | 关键字段 |
|---|---|---|
| `wallet_ledger` | 不可变钱包流水 | `id`, `user_id`, `type`, `amount`, `currency`, `rental_id`, `topup_id`, `balance_after`, `idempotency_key`, `created_at` |
| `topups` | 充值订单 | `id`, `user_id`, `provider`, `amount`, `currency`, `status`, `stripe_session_id`, `created_at`, `completed_at` |
| `billing_ticks` | 滴答扣费记录 | `id`, `rental_id`, `user_id`, `period_start`, `period_end`, `amount`, `status` |
| `provision_attempts` | 每次开机尝试 | `id`, `rental_id`, `attempt_no`, `provider`, `region`, `plan`, `vps_id`, `ip`, `status`, `failure_reason` |
| `probe_nodes` | 大陆探针节点 | `id`, `provider`, `region`, `province`, `city`, `endpoint`, `status`, `weight`, `last_seen_at` |
| `probe_runs` | 一次探测任务 | `id`, `rental_id`, `attempt_id`, `source`, `trigger`, `operator_user_id`, `policy_snapshot`, `ip`, `port`, `protocol`, `status`, `pass_ratio`, `decision` |
| `probe_results` | 单探针结果 | `id`, `probe_run_id`, `probe_node_id`, `ok`, `latency_ms`, `error_code`, `raw_detail` |
| `disguise_domains` | Reality/Hysteria 可用伪装域名池 | `id`, `domain`, `protocol`, `weight`, `status`, `last_verified_at` |
| `safety_policies` | 节点防滥用策略 | `id`, `name`, `egress_block_ports`, `enabled`, `updated_at` |

## API 设计原则

- Canonical API 放在 Core API；Next.js API 只做同源代理、格式转换和自托管部署辅助。
- 用户 API 使用 `Authorization: Bearer <session>`。
- 管理 API 支持管理员 session 或 `X-API-Secret`，长期应逐步收敛到管理员 session + scoped admin token。
- 内部 API 使用 `Authorization: Bearer <PROVISION_SERVER_TOKEN>` 或单独的 internal service token。
- 会创建订单、充值、租用、销毁的 API 必须支持 `Idempotency-Key`。
- 长任务 API 只返回任务 ID/租用 ID，不阻塞等待完成。
- 前端进度优先通过 `GET /api/rental/:id/progress` 轮询，后续可增加 SSE。
- 所有响应长期统一为 `{ data, error, requestId }`；现有 API 可以兼容旧格式。

## 现有 Core API

这些 API 当前主要由 `server/src/index.ts` 提供，Next.js 的 catch-all 代理会将 `/api/*` 转发到同名 Core API。

| API | 鉴权 | 当前职责 | 长期规划 |
|---|---|---|---|
| `GET /health` | 无 | 检查 database、redis、provision server | 增加 queue、billing cron、probe service、provider access 的分项健康 |
| `POST /api/auth/request-link` | 无 | 创建/查找用户，生成 magic token，发送登录邮件 | 增加邮箱限流、设备指纹、统一审计事件 |
| `POST /api/auth/verify` | 无 | 校验 magic token，签发 session | 增加 refresh token、session revoke、登录审计 |
| `GET /api/auth/me` | 用户 | 返回当前用户和 admin 标识 | 增加 wallet summary、feature flags 可选展开 |
| `POST /api/auth/register` | 无 | 兼容旧注册，直接签发 session | 长期标记 deprecated，只保留 magic link |
| `POST /api/auth/login` | 无 | 兼容旧登录，按邮箱签发 session | 长期标记 deprecated，生产关闭 |
| `POST /api/payment/checkout` | 无 | Stripe 直接创建租用支付 session | 转为 `POST /api/wallet/topups/checkout`；直接租用支付仅兼容旧版本 |
| `POST /api/payment/webhook` | Stripe 签名 | 处理新租用和续费 webhook | 拆分为 topup 入账、租用续费、幂等事件表 |
| `POST /api/payment/renew` | 用户 | 为 active/paused 租用创建续费 checkout | 改为余额续费优先，Stripe 只负责充值 |
| `GET /api/rental/session/:sessionId` | 无 | Stripe 成功页用 session 查 rental | 充值模式下改为查 topup 状态；租用状态走 rental progress |
| `POST /api/redeem/validate` | 无 | 校验兑换码可用性 | 返回 grant 类型：余额、免费时长、折扣 |
| `POST /api/redeem` | 用户 | 兑换码直接创建免费租用 | 改为可选：入账到钱包或创建免费租用 |
| `POST /api/rental` | 用户 | 创建租用记录并入 provision 队列 | 改为钱包扣款或 grant 消耗后创建；初始状态 `pending` |
| `GET /api/rentals` | 用户 | 返回当前用户租用列表和剩余分钟 | 增加 `progress`, `lastStage`, `billing`, `canDestroy`, `canRenew` |
| `GET /api/rental/:id` | 用户 | 返回单个租用和剩余分钟 | 增加状态机详情、当前 attempt、探针摘要、计费摘要 |
| `GET /api/rental/:id/config` | 用户 | active 后返回 Redis 中的原始配置 | 保持；未通过探针或未 active 时必须继续返回 `202` |
| `POST /api/rental/:id/pause` | 用户 | 将 active 租用改为 paused | 长期需定义真实暂停语义；如无法暂停云成本，应改名或下线 |
| `POST /api/rental/:id/resume` | 用户 | 将 paused 改回 active | 同上，需与真实计费和云资源状态一致 |
| `POST /api/rental/:id/destroy` | 用户 | 标记 destroyed，入队 destroy，清缓存 | 改为先置 `destroying`，worker 成功后置 `destroyed` |
| `GET /api/payments` | 用户 | 返回支付记录并关联租用摘要 | 长期拆成 `topups` 与 `wallet_ledger`，保留兼容视图 |

## 现有 Cloudflare Worker API

`web/workers` 是 Cloudflare 运行路径的旧 API 实现。当前自托管 Core API 已经覆盖大部分能力，长期需要二选一：要么正式退役 Worker API，要么用同一份 OpenAPI/handler 生成两个运行时，避免两套路由行为漂移。

| API | 当前职责 | 长期规划 |
|---|---|---|
| `POST /api/auth/register` | Worker 版注册 | 跟随 Core API deprecated |
| `POST /api/auth/login` | Worker 版登录 | 跟随 Core API deprecated |
| `POST /api/rental` | Worker 版创建租用 | 与 Core API 统一到钱包扣款和状态机 |
| `GET /api/payments` | Worker 版支付列表 | 与 Core API 统一到 wallet/topup/ledger 视图 |
| `GET /api/rentals` | Worker 版租用列表 | 与 Core API 统一返回 progress/billing |
| `GET /api/rental/:id` | Worker 版租用详情 | 与 Core API 统一 |
| `GET /api/rental/:id/config` | Worker 版配置获取 | 保持 active-only 交付约束 |
| `POST /api/rental/:id/pause` | Worker 版暂停 | 与 Core API 一起重新定义真实暂停语义 |
| `POST /api/rental/:id/resume` | Worker 版恢复 | 与 Core API 一起重新定义真实恢复语义 |
| `POST /api/rental/:id/destroy` | Worker 版销毁 | 与 Core API 统一为 `destroying` -> `destroyed` |
| `POST /api/redeem/validate` | Worker 版兑换码校验 | 与 wallet redeem 统一 |
| `POST /api/redeem` | Worker 版兑换码租用 | 与 wallet redeem 统一 |
| `POST /api/admin/redeem-codes` | Worker 版生成兑换码 | 与 Core Admin API 统一 |
| `GET /api/admin/redeem-codes` | Worker 版兑换码列表 | 与 Core Admin API 统一 |
| `GET /api/rental/session/:sessionId` | Worker 版 Stripe 成功页查询 | 充值模式下改查 topup |
| `GET /health` | Worker 健康检查 | 若 Worker 退役则删除；若保留则纳入统一健康契约 |
| `POST /api/payment/checkout` | Worker billing router 创建 Stripe checkout | 转为钱包充值 checkout |
| `POST /api/payment/webhook` | Worker billing router 处理 Stripe webhook | 转为 topup 入账和 ledger 幂等 |
| `POST /api/payment/renew` | Worker billing router 创建续费 checkout | 转为余额续费优先 |

## 现有 Admin API

| API | 鉴权 | 当前职责 | 长期规划 |
|---|---|---|---|
| `POST /api/admin/redeem-codes` | 管理员 | 批量生成兑换码 | 增加 grant 类型、批次、发行人、限用规则 |
| `GET /api/admin/redeem-codes` | 管理员 | 列出兑换码及使用者 | 增加过滤、分页、批次统计 |
| `PATCH /api/admin/redeem-codes/:id` | 管理员 | 更新 duration/expiresAt | 增加禁用、备注、批次级更新 |
| `DELETE /api/admin/redeem-codes/:id` | 管理员 | 删除未使用兑换码 | 保持；已使用只能禁用或归档 |
| `GET /api/admin/overview` | 管理员 | 概览、队列、失败任务、stage logs、健康 | 增加探针健康、坏 IP 率、重试成本、钱包风险 |
| `GET /api/admin/search?q=` | 管理员 | 搜索用户和租用 | 增加按 VPS ID、IP、provider instance、probe run 搜索 |
| `GET /api/admin/rentals/:id` | 管理员 | 租用详情、配置、审计、stage logs | 增加 attempts、probe results、billing ticks、ledger entries |
| `POST /api/admin/rentals/:id/destroy` | 管理员 | 强制销毁，入 destroy 队列 | 改为 `destroying` 状态，记录 admin reason |
| `POST /api/admin/rentals/:id/release-provisioning` | 管理员 | 释放无 IP/VPS 的卡住 provisioning | 扩展为 release failed/pending/probing，但必须保护有云资源的租用 |
| `POST /api/admin/debug/provision-test` | 管理员 | 创建调试租用并入队 | 增加 probe-only、provider-only、config-only 模式 |
| `POST /api/admin/debug/provider-check` | 管理员 | 调用 Provision Server provider check | 增加按 provider/region/plan 检查 |

## 现有 Next.js API

| API | 当前职责 | 长期规划 |
|---|---|---|
| `/api/[...path]` | 同源代理到 Core API 的 `/api/*`，透传 GET/POST/PUT/PATCH/DELETE | 保持为 BFF 入口，统一 timeout、requestId、no-store headers |
| `POST /api/auth/request-link` | 代理登录邮件请求 | 保持，后续补 requestId |
| `POST /api/auth/verify` | 代理 magic token 校验 | 保持 |
| `GET /api/auth/me` | 代理当前用户 | 保持 |
| `GET /api/admin/overview` | 代理 admin overview | 保持 |
| `GET/POST /api/admin/redeem-codes` | 代理兑换码列表/生成 | 保持 |
| `PATCH/DELETE /api/admin/redeem-codes/:id` | 代理兑换码更新/删除 | 保持 |
| `GET /api/admin/search` | 代理管理员搜索 | 保持 |
| `GET /api/admin/rentals/:id` | 代理租用详情 | 保持 |
| `POST /api/admin/rentals/:id/destroy` | 代理强制销毁 | 保持 |
| `POST /api/admin/rentals/:id/release-provisioning` | 代理释放卡单 | 保持 |
| `POST /api/admin/debug/provider-check` | 代理 provider check | 保持 |
| `POST /api/admin/debug/provision-test` | 代理 provision test | 保持 |
| `GET /api/rental/:id/config/:client` | 将原始配置转为 clash-meta、singbox、v2rayn、shadowrocket | 保持；输入必须只来自 active 配置 |
| `GET /api/rental/:id/subscription` | 生成订阅链接内容或 raw 文本 | 保持；支持短期 token 化订阅 URL |
| `POST /api/self-hosted` | 用户自托管部署，支持 API 模式和 SSH 模式 | 与按租租用分离，长期移到 `/api/self-hosted/deployments` |
| `GET /api/self-hosted` | 列出内存中的部署任务 | 改为持久化 deployment 表 |
| `GET /api/self-hosted/:id` | 查询自托管部署进度 | 改为持久化，可恢复进度 |

## 现有 Provision Server API

这些 API 是内部服务，不应直接暴露到公网。

| API | 鉴权 | 当前职责 | 长期规划 |
|---|---|---|---|
| `GET /health` | 无 | 检查 env 是否完整，返回 `ok/degraded` | 增加 provider dry-read、script availability、SSH key directory、probe dependency |
| `POST /api/provider-check` | internal bearer | 调用 provider `listServersByTag` 验证 API 权限 | 支持 `{ provider, region, plan }`，返回权限细分 |
| `POST /api/provision` | internal bearer | 创建 VPS，等 SSH，SSH 上传脚本，返回 config/IP/VPS ID/stage logs | 增加 attemptId、probePolicy、cloud-init、探针前置/后置、坏 IP 自动销毁重试 |
| `POST /api/destroy` | internal bearer | 按 vpsId 或 rental label 清理并删除云主机 | 保持幂等；增加 destroy reason、attemptId、cloud residual report |

## 目标新增用户 API

| API | 鉴权 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| `GET /api/catalog/regions` | 无 | query: `provider?`, `protocol?` | 可售地区、延迟/价格摘要 | 前端选择 Tokyo 等地区 |
| `GET /api/catalog/plans` | 无 | query: `provider?`, `region?` | 可售规格和成本 | 管控成本与库存 |
| `POST /api/rental/quote` | 用户 | `{ protocol, region, durationMinutes }` | `{ quoteId, price, balanceRequired, expiresAt }` | 创建租用前报价，避免前端硬编码价格 |
| `POST /api/rental` | 用户 | `{ quoteId, protocol, region, durationMinutes, paymentSource }` | `{ rentalId, status: "pending" }` | 长期用余额/grant 创建租用；保留旧字段兼容 |
| `GET /api/rental/:id/progress` | 用户 | path id | `{ status, stage, message, percent, attempt, probe, billing }` | 前端每 1-2 秒轮询 |
| `GET /api/rental/:id/events` | 用户 | path id | SSE stream | 可选，替代高频轮询 |
| `POST /api/rental/:id/extend` | 用户 | `{ durationMinutes, paymentSource }` | `{ expiresAt, chargedAmount }` | 余额续时优先 |
| `GET /api/rental/:id/billing` | 用户 | path id | tick 列表和汇总 | 让用户看到扣费依据 |
| `GET /api/rental/:id/probes` | 用户 | path id | 探针摘要，不暴露敏感节点 | 可解释“正在精选资源”但不过度暴露策略 |
| `POST /api/rental/:id/destroy` | 用户 | `{ reason? }` | `{ status: "destroying" }` | 替代立即置 `destroyed` |

## 目标新增钱包 API

| API | 鉴权 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| `GET /api/wallet` | 用户 | 无 | `{ balance, currency, reserved, available }` | 首页和租用前检查 |
| `GET /api/wallet/ledger` | 用户 | query: `cursor?`, `limit?` | 钱包流水 | 每次充值、扣费、退款都可审计 |
| `POST /api/wallet/topups/checkout` | 用户 | `{ amount, currency, provider: "stripe" }` | `{ topupId, checkoutUrl }` | 取代 0.5 元小额直接支付 |
| `GET /api/wallet/topups/:id` | 用户 | path id | `{ status, amount, completedAt }` | 充值成功页轮询 |
| `POST /api/wallet/topups/webhook` | Stripe 签名 | Stripe event raw body | `{ received: true }` | 幂等入账到 `wallet_ledger` |
| `POST /api/wallet/redeem` | 用户 | `{ code }` | `{ balanceDelta, grant }` | 替代或包装现有 `/api/redeem` |
| `POST /internal/billing/tick` | internal cron | `{ now? }` | `{ charged, destroyed, skipped }` | 每 5/10 分钟扫描 active rentals |
| `POST /internal/billing/rentals/:id/charge` | internal | `{ periodStart, periodEnd }` | `{ chargedAmount, balanceAfter }` | 单租用扣费，便于测试和重试 |
| `POST /internal/billing/rentals/:id/low-balance-destroy` | internal | `{ thresholdMinutes }` | `{ queuedDestroy: true }` | 余额不足提前销毁 |

计费原则：

- `wallet_ledger.amount` 入账为正数，扣费为负数。
- `users.balance` 只缓存最近余额，所有余额必须能从 ledger 重放。
- tick API 必须幂等，同一 `rental_id + period_start + period_end` 只能扣一次。
- 余额不足时先置 `destroying` 并入 destroy 队列，不能继续产生云厂商成本。

## 目标新增探针 API

探针系统是 `流程.md` 的核心护城河。它应独立为 Probe Service 或 Core API 内部模块，部署在中国大陆多地域机器上。

| API | 鉴权 | 调用方 | 请求 | 响应 | 说明 |
|---|---|---|---|---|---|
| `POST /internal/probes/runs` | internal | Provision worker | `{ rentalId, attemptId, ip, port, protocol, policy }` | `{ probeRunId, status: "queued" }` | 创建探测任务 |
| `GET /internal/probes/runs/:id` | internal | Provision worker | path id | `{ status, passRatio, decision, results }` | worker 轮询探测结果 |
| `POST /internal/probes/results` | probe token | 探针节点 | `{ probeRunId, nodeId, ok, latencyMs, errorCode, detail }` | `{ accepted: true }` | 探针上报结果 |
| `POST /internal/probes/agents/heartbeat` | probe token | 探针节点 | `{ nodeId, region, province, city, version }` | `{ accepted: true, config }` | 探针保活和拉取策略 |
| `POST /api/admin/probes/run` | 管理员 | Admin UI | `{ ip, port, protocol, policy? }` | `{ probeRunId }` | 手工测试某 IP |
| `GET /api/admin/probes/runs` | 管理员 | query: `rentalId?`, `status?`, `decision?`, `limit?` | 最近探针运行列表 | 当前先由 `audit_log` 推断，后续切结构化表 |
| `GET /api/admin/probes/runs/:id` | 管理员 | Admin UI | path id | 完整探针结果 | 排障使用 |
| `GET /api/admin/probes/nodes` | 管理员 | Admin UI | query | 探针节点健康 | 发现失联探针 |

探针判定策略：

- 默认测试 TCP 443 握手，不能用 ping 作为唯一依据。
- 最少 3 个大陆探针节点参与；长期目标为多省份、多运营商。
- 结果采用投票：例如通过率 >= 70% 判定可交付。
- 任一探针超时不等于整体失败，但要计入可观测性。
- 探测失败时记录 `stage2.5-*-failed`，销毁该 VPS，并进入下一次 `provision_attempt`。
- 重试必须有上限，例如 `maxAttempts=5`，耗尽后置 `failed` 或退款。

示例请求：

```json
{
  "rentalId": "rental_123",
  "attemptId": "attempt_1",
  "ip": "203.0.113.5",
  "port": 443,
  "protocol": "vless-reality",
  "policy": {
    "minNodes": 3,
    "timeoutMs": 5000,
    "passRatio": 0.7
  }
}
```

示例进度响应：

```json
{
  "status": "probing",
  "stage": "stage2.5-2-mainland-tcp-probe",
  "message": "Testing TCP 443 from mainland probes",
  "percent": 45,
  "attempt": {
    "attemptNo": 2,
    "maxAttempts": 5,
    "ip": "203.0.113.5"
  },
  "probe": {
    "probeRunId": "probe_123",
    "completedNodes": 2,
    "requiredNodes": 3
  }
}
```

## 目标新增 Provision API 细节

`POST /api/provision` 长期请求体：

```json
{
  "rentalId": "rental_123",
  "attemptId": "attempt_1",
  "protocol": "vless-reality",
  "provider": "vultr",
  "region": "nrt",
  "plan": "vhf-1c-1gb",
  "probePolicy": {
    "enabled": true,
    "port": 443,
    "maxAttempts": 5
  },
  "installMode": "cloud-init-preferred"
}
```

长期响应：

```json
{
  "rentalId": "rental_123",
  "attemptId": "attempt_1",
  "vpsId": "provider-instance-id",
  "ip": "203.0.113.5",
  "status": "configured",
  "config": {
    "protocol": "vless-reality",
    "ip": "203.0.113.5",
    "port": "443"
  },
  "debug": {
    "stageLogs": []
  }
}
```

Provision worker 行为：

1. 创建 `provision_attempts`。
2. 调用 provider create server。
3. 记录 IP。
4. 进入 `probing`，调用 Probe API。
5. 如果探针失败，调用 provider delete server，记录失败 attempt，重新创建下一台。
6. 如果探针通过，进入 `configuring`。
7. 优先使用 cloud-init 状态确认；失败时 fallback SSH。
8. 安装协议、域名伪装、防火墙策略。
9. 返回配置并由 Core API 写缓存、置 `active`。

## 外部云厂商 API

当前 provider adapter 已使用以下外部 API。长期应保持在 provider adapter 内部，不允许前端直接持有云厂商 API key。

### Vultr

| 外部 API | 当前用途 | 长期补充 |
|---|---|---|
| `GET /v2/ssh-keys` | 查找是否已有 AnixOps SSH key | 增加分页和 key label 过滤 |
| `POST /v2/ssh-keys` | 注册 SSH public key | 支持 key rotation |
| `POST /v2/instances` | 创建 VPS | 增加 `user_data`/cloud-init、防火墙组、标签、region/plan 策略 |
| `GET /v2/instances` | 按 label 查找 VPS | 用于幂等复用和销毁残留 |
| `GET /v2/instances/{id}` | 查询实例 IP/状态 | 用于等待公网 IP 和状态 |
| `DELETE /v2/instances/{id}` | 删除 VPS | 探针失败、到期、余额不足、用户销毁 |

### DigitalOcean

| 外部 API | 当前用途 | 长期补充 |
|---|---|---|
| `GET /v2/account/keys` | 查找 SSH key | 增加分页 |
| `POST /v2/account/keys` | 注册 SSH key | 支持 key rotation |
| `POST /v2/droplets` | 创建 VPS | 增加 cloud-init `user_data`、tags、VPC/firewall |
| `GET /v2/droplets?per_page=200` | 按名称查找 VPS | 改为 tags 优先 |
| `GET /v2/droplets/{id}` | 查询 IP/状态 | 等公网 IP |
| `DELETE /v2/droplets/{id}` | 删除 VPS | 销毁路径 |

### AWS EC2

| 外部 API/操作 | 当前用途 | 长期补充 |
|---|---|---|
| `ImportKeyPair` | 自托管 API 模式导入 key | 统一到 provider adapter |
| `RunInstances` | 创建 EC2 | 增加 UserData、IAM 最小权限、标签 |
| `DescribeInstances` | 查询 IP/状态/按 tag 查找 | 用于幂等和销毁 |
| `TerminateInstances` | 删除实例 | 销毁路径 |

### Cloudflare DNS

仅用于自托管部署时自动创建 A 记录。

| 外部 API | 当前用途 | 长期补充 |
|---|---|---|
| `GET /client/v4/zones?name=` | 找到 zone | 增加明确 zoneId 输入，避免猜测 |
| `GET /client/v4/zones/{zoneId}/dns_records` | 查找现有 A 记录 | 增加 AAAA/CNAME 支持 |
| `PATCH /client/v4/zones/{zoneId}/dns_records/{id}` | 更新 A 记录 | 增加回滚记录 |
| `POST /client/v4/zones/{zoneId}/dns_records` | 创建 A 记录 | 增加 TTL/proxied 策略 |

### Stripe

| 外部 API/事件 | 当前用途 | 长期补充 |
|---|---|---|
| Checkout Session create | 直接租用支付、续费 | 改为钱包充值 checkout |
| `checkout.session.completed` webhook | 创建租用或续费 | 改为 topup 入账和 ledger 幂等 |
| Webhook signature verification | 防伪造 | 保持，事件 ID 入库去重 |

### Probe Provider

`ping.pe` 可作为人工参考，但不应作为核心自动化依赖。目标是抽象 Probe Provider：

- 自建大陆探针 agent 是首选。
- 第三方可作为 fallback，例如 Globalping 做通用 TCP 检查，17CE 做中国大陆覆盖。
- 第三方 API 只放在 probe adapter 内，不进入核心业务代码。

## 分期路线图

### Phase 0: API 契约固化

目标：

- 生成并维护 AnixOps 自己的 OpenAPI，而不是只保留云厂商 spec。
- 给现有 Core API、Provision API、Next BFF API 补齐契约文档。
- 统一错误码、requestId、幂等键处理。

涉及 API：

- 全部现有 Core API。
- 全部现有 Admin API。
- `GET /health` 增强依赖项。
- `POST /api/admin/debug/provider-check` 增加 region/plan 入参。

验收：

- 文档列出每个 API 的 auth、请求、响应和错误码。
- 测试覆盖 401/403/429/400/409/5xx。
- `git diff --check`, `npm run lint`, `npm test` 通过。

### Phase 1: 大陆探针 MVP

目标：

- 新增 Probe Service 和大陆探针 agent。
- 在租用交付前加入 `stage2.5-*`。
- 管理端能看到探针结果。

涉及 API：

- `POST /internal/probes/runs`
- `GET /internal/probes/runs/:id`
- `POST /internal/probes/results`
- `POST /internal/probes/agents/heartbeat`
- `POST /api/admin/probes/run`
- `GET /api/admin/probes/runs`
- `GET /api/admin/probes/runs/:id`
- `GET /api/admin/probes/nodes`
- `GET /api/rental/:id/progress`

验收：

- 模拟坏 IP 时租用不会进入 `active`。
- 探针失败原因写入 `audit_log` 和 `probe_results`。
- 用户只能看到进度，不会拿到失败 IP 的配置。

### Phase 2: 坏 IP 静默销毁与重试

目标：

- 引入 `provision_attempts`。
- 每次坏 IP 自动删除对应云主机。
- 重试上限、成本上限、失败释放、退款策略明确。

涉及 API：

- `POST /api/provision` 增加 `attemptId`, `probePolicy`。
- `POST /api/destroy` 增加 `attemptId`, `reason`。
- `GET /api/rental/:id/progress` 展示 attempt 进度。
- `GET /api/admin/rentals/:id` 展示 attempts 和 probe runs。

验收：

- 连续 2 个探针失败 IP 会创建 2 条 failed attempt，并触发 2 次 destroy。
- 第 3 个通过 IP 才进入 `configuring/active`。
- maxAttempts 耗尽时租用置 `failed` 或 `released`，云资源清零。

### Phase 3: 预充值钱包和滴答计费

目标：

- 从“小额直接支付”切到“先充值，再按分钟/5分钟扣费”。
- 余额不足提前销毁。
- 所有余额可由 ledger 重算。

涉及 API：

- `GET /api/wallet`
- `GET /api/wallet/ledger`
- `POST /api/wallet/topups/checkout`
- `GET /api/wallet/topups/:id`
- `POST /api/wallet/topups/webhook`
- `POST /api/wallet/redeem`
- `POST /api/rental/quote`
- `POST /internal/billing/tick`
- `POST /internal/billing/rentals/:id/charge`
- `POST /internal/billing/rentals/:id/low-balance-destroy`

验收：

- 充值 10 元入账为一条正流水。
- 每个 tick 产生一条负流水和一条 `billing_ticks`。
- 同一 tick 重试不会重复扣费。
- 余额不足以覆盖未来 10 分钟时，租用进入 `destroying` 并触发云资源删除。

### Phase 4: 节点安装、安全和伪装增强

目标：

- cloud-init 优先，SSH fallback。
- Reality 伪装域名池。
- 出站安全策略封锁 25 端口和 BT 常见端口。
- 安装完成后做本机服务健康和大陆探针复测。

涉及 API：

- `POST /api/provision` 增加 `installMode`, `disguiseDomainId`, `safetyPolicyId`。
- `GET /api/admin/disguise-domains`
- `POST /api/admin/disguise-domains`
- `PATCH /api/admin/disguise-domains/:id`
- `GET /api/admin/safety-policies`
- `PATCH /api/admin/safety-policies/:id`

验收：

- 新机器开机后无需人工 SSH 即可完成协议安装。
- 25 端口被封锁，协议端口仍可用。
- 每次交付记录实际使用的伪装域名。

### Phase 5: 多云、多地区和容量策略

目标：

- 支持按地区、成本、坏 IP 率自动选择 provider/region/plan。
- 可临时禁用坏 IP 率高的 region。
- 管理端可看到 provider 成本和成功率。

涉及 API：

- `GET /api/catalog/regions`
- `GET /api/catalog/plans`
- `GET /api/admin/providers`
- `POST /api/admin/providers/:provider/check`
- `PATCH /api/admin/providers/:provider/regions/:region`
- `GET /api/admin/capacity`

验收：

- Tokyo Vultr 坏 IP 率超过阈值时自动降权。
- 管理员可禁用 region，用户 catalog 不再展示。
- provider check 可按 provider/region/plan 返回可用性。

### Phase 6: 运营、风控和审计闭环

目标：

- 管理端能完整追踪用户、钱包、租用、云资源、探针、计费。
- 支持退款、补偿、冻结、人工复核。
- 输出运营指标：交付成功率、平均交付时间、坏 IP 率、单租用毛利。

涉及 API：

- `GET /api/admin/users/:id`
- `GET /api/admin/users/:id/ledger`
- `POST /api/admin/users/:id/credit`
- `POST /api/admin/users/:id/freeze`
- `POST /api/admin/rentals/:id/refund`
- `GET /api/admin/metrics/provisioning`
- `GET /api/admin/metrics/billing`
- `GET /api/admin/metrics/probes`

验收：

- 每个金额变动有原因、操作者、幂等键。
- 每个失败租用可追到 provider response、probe results、stage logs。
- 管理操作全部写入审计。

## Prompt-to-Artifact Checklist

| `流程.md` 要求 | 本规划覆盖位置 | 当前判断 |
|---|---|---|
| 自动避开被墙 IP | 目标新增探针 API、Phase 1、Phase 2 | Partial：已有 `stage2.5-*` 探针钩子、结构化 probe 表和统一探测语义，但仍缺稳定的大陆多点覆盖与自动重试策略 |
| 坏 IP 静默销毁重试 | 状态机、Provision API 细节、Phase 2 | Partial：已有 `provision_attempts` 与 probe fail destroy/retry 路径，但仍需把真实多点探测、阈值策略和用户侧语义继续收口 |
| 云厂商 API 调度 | 外部云厂商 API、现有 Provision API | Done at current provider-adapter / catalog level |
| 实时机器状态追踪 | 状态机、`GET /api/rental/:id/progress`、stage 组 | Done at polling level |
| 异步处理机制 | API 设计原则、现有队列、目标 progress/events | Partial：BullMQ 与 internal workers 已在，SSE events 仍未实现 |
| Cloud-init 自动安装 | Phase 4、Provision API 细节 | Done with SSH fallback retained |
| 伪装域名池 | 数据模型、Phase 4 | Done at env-configured domain-pool level |
| 防滥用防火墙 | 数据模型、Phase 4 | Partial：脚本级拒绝 + `compliance_profiles` / binding / strict mode 已有，但购买侧和命中统计还未产品化 |
| 预充值钱包 | 目标新增钱包 API、Phase 3 | Done |
| 滴答计费器 | 目标新增钱包 API、Phase 3 | Done |
| 余额不足强制断电 | `low-balance-destroy`、Phase 3 | Done |
| 前端只负责展示与轮询 | Next.js API、`progress/events` | Done at same-origin proxy + aggregate API level |
| 后端高并发调度 | Core API、队列、Provision API | Partial：队列与内部计费 / 探测接口已在，仍缺进一步拆分与观测 |
| 数据库与 Redis | 数据模型规划 | Done |
| 小明全流程时间线 | 状态机、分期路线图、用户 API | Partial：console / progress / referrals 已覆盖主链路，合规购买侧和上链仍未接入 |
