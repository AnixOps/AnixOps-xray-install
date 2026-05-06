# AnixOps 用户后台与合规闭环长期规划

## 目标

这份规划聚焦六件事：

1. 手工探测和自动交付探测统一出现在后台列表。
2. 做完整的用户侧后台，用户能看到余额、节点、剩余时长、账单和探测状态。
3. 把 CDK 从“送时长”扩展成“可充值余额”的正式资金通道。
4. 增加虚拟货币充值余额能力。
5. 增加邀请码返余额能力，并且所有奖励都进入统一钱包账本。
6. 把节点出站流量限制到合规范围，并让关键流程可追溯、可验真，最终做链上锚定。

## 现状判断

当前仓库已经有一批能复用的基础能力：

- 用户认证已经存在，`/api/auth/me` 可返回用户身份。
- 钱包底座已经存在，`/api/wallet`、`/api/wallet/ledger`、Stripe 充值、`POST /api/wallet/redeem`、`wallet_ledger`、`topups`、`billing_ticks` 都已落地。
- 节点账单和剩余时长已经有单节点接口，`/api/rental/:id`、`/api/rental/:id/billing`、`/api/rental/:id/progress`、`/api/rental/:id/probes` 都在。
- 用户账户后台 MVP 已落地，`/api/console/overview`、`/api/console/nodes`、`/api/console/wallet`、`/api/console/audit` 和 `/console*` 页面都已接入当前 Next app。
- 管理端已有探测节点、探测运行列表和手工触发探测接口，`/api/admin/probes/nodes`、`/api/admin/probes/runs`、`/api/admin/probes/run` 已存在。
- 部署脚本已经开始做安全限制，`scripts/vless-reality.sh` 和 `scripts/hysteria2.sh` 已阻断 SMTP 和常见 BT 端口。

当前缺口也很明确：

- `/api/console/referrals` 已接入邀请中心页面和返余额模型，返回邀请码、绑定状态和返佣历史。
- 钱包虽然已经有账本和充值链路，但 CDK 仍偏“时长兑换”，还不是正式余额充值产品。
- 没有邀请码、邀请绑定、返佣奖励的数据模型。
- 手工探测和自动交付探测虽然都能落数据，但还没有一个统一的“探测中心视图”和统一事件字段。
- 审计日志目前仍偏文本化，适合排查，不适合做强校验、强追溯、链上锚定。
- 现在的出站限制还是“黑名单式封禁几个高风险端口”，还不是“合规模式下的默认拒绝 + 白名单放行”。

## 先讲清楚的产品边界

### 1. “只允许 HTTP/HTTPS/WebSocket” 不能只靠端口保证

如果只允许目标端口 `80/443/8080`，风险会下降，但不能严格证明流量一定就是 HTTP/HTTPS/WebSocket：

- BT 可以伪装到 `80/443`。
- 其他自定义 TCP 协议也可以跑在 `443`。
- 仅靠四层端口白名单，无法证明应用层意图。

结论：

- 如果目标是“明显降低滥用概率”，端口白名单是有效手段。
- 如果目标是“严格合规证明只允许网页类流量”，必须把产品收紧成“受控 Web 出站网关”，不能继续把它当通用代理卖点。

### 2. 建议拆成两条产品线

建议后续长期存在两种运行模式：

- 标准节点模式：延续当前能力，适合普通租用，做基础风控和常见端口封禁。
- 合规模式：默认拒绝出站，仅放行允许的目标端口和必要系统依赖，并关闭高风险协议能力。

如果你要把“合规”作为主打，建议优先把合规模式产品化，而不是试图用一套策略同时兼顾“通用代理”和“严格合规”。

### 3. 合规模式下不建议继续默认提供 Hysteria2

Hysteria2 本身是 UDP/QUIC 方向，适合低延迟、高吞吐场景，但和“只允许常见网页流量”的产品叙事不完全一致。

建议：

- 合规模式只开放 `vless-reality` 或者更进一步改成基于 HTTP CONNECT / WebSocket 的受控出口。
- Hysteria2 作为标准模式保留，或者直接下线。

## 目标架构

### A. 用户侧后台

用户后台不再围绕“单次租用结果页”设计，而是围绕“账户”设计，至少包含五个一级页面：

1. 总览：余额、可用节点数、运行中节点、即将到期节点、最近充值、最近返利。
2. 我的节点：节点列表、协议、IP、状态、剩余时长、最近探测结果、续费/销毁入口。
3. 钱包中心：余额、充值订单、CDK 兑换、虚拟币充值、账本流水、退款/返利记录。
4. 邀请中心：我的邀请码、邀请人数、已返余额、待结算奖励、规则说明。
5. 审计与合规：节点策略、被拦截流量统计、重要操作记录、探测记录摘要。

建议新增一个账户聚合接口层，而不是前端自己拼十几个接口：

- `GET /api/console/overview`
- `GET /api/console/nodes`
- `GET /api/console/wallet`
- `GET /api/console/referrals`
- `GET /api/console/audit`

其中 `overview` / `nodes` / `wallet` / `audit` 已于 2026-05-06 落地，`referrals` 仍为占位响应，等待邀请码与返余额模型接入。

### B. 钱包与资金系统

钱包必须成为唯一资金真相源，所有余额变化都只通过账本落地：

- Stripe 充值
- CDK 充值
- 虚拟币充值
- 邀请返利
- 人工补偿
- 计费扣款
- 退款返还

现有 `wallet_ledger` 可以继续用，但建议扩展成更稳定的结构：

- `type`
- `amount`
- `currency`
- `reference_type`
- `reference_id`
- `idempotency_key`
- `metadata`
- `balance_after`

原则：

- 不要让任何“返余额”“补余额”“CDK 入账”“虚拟币确认”绕开账本。
- `users.balance` 只做冗余快照，最终仍以最新账本余额为准。

### C. 探测中心统一化

手工探测和自动交付探测都应该进同一张“探测运行视图”：

- `source`: `delivery` | `manual` | `scheduled`
- `trigger`: `auto` | `manual` | `retry`
- `policy_snapshot`
- `target_ip`
- `target_port`
- `decision`
- `completed_nodes`
- `required_nodes`
- `provider`
- `provider_run_id`
- `operator_user_id`
- `linked_rental_id`

管理端统一展示一张列表，不再按“手工”和“自动”拆页面。

用户侧可以只暴露和自己节点相关的探测摘要：

- 首次交付探测是否通过
- 最近一次人工复检结果
- 最近失败原因
- 探测节点数量和通过率

### D. 合规控制面

合规控制建议拆成三层：

1. 策略层
   - 定义节点允许的出站协议、目标端口、DNS 解析方式、是否允许 UDP、是否允许续费。
2. 执行层
   - 部署脚本把策略下发到节点，优先使用 `nftables`，必要时兼容 `iptables`。
3. 观测层
   - 记录命中拒绝规则的次数、目标端口分布、异常连接峰值。

建议的合规模式基线：

- 默认拒绝全部出站。
- 允许系统必要访问：
  - DNS 到指定解析器
  - NTP
  - 包更新镜像源，仅在初始化或受控维护窗口放行
- 允许业务出站：
  - `tcp/80`
  - `tcp/443`
  - `tcp/8080`
  - 可选 `tcp/8443`
- 默认拒绝全部业务 UDP。
- 显式拒绝：
  - `25/465/587`
  - `6881-6999`
  - `51413`
  - 其他所有未允许端口

如果未来要做到更强证明，建议把“允许的网页流量”进一步收紧为：

- 仅允许 `CONNECT` 到指定目标端口
- 统一经 Envoy / Squid / HAProxy 之类的受控出口转发
- 对域名、SNI、Host 做规则校验和采样审计

### E. 审计与上链

“所有流程可追溯可查”建议分两层做，不建议把原始日志直接上公链：

1. 本地不可篡改审计链
   - 每条审计事件保存 `event_hash` 和 `prev_event_hash`
   - 构成应用内 hash chain
2. 链上锚定
   - 每 5 分钟或每小时把一批审计事件做 Merkle Root
   - 只把 Root、批次号、时间戳、环境标识上链

原因：

- 原始日志直接上链成本高。
- 原始日志可能含敏感信息，不适合公开暴露。
- 哈希锚定已经足够实现“事后可验真”。

推荐顺序：

- 先做本地 append-only 审计账本。
- 再做对象存储归档。
- 最后做链上 Root 锚定。

## 建议新增的数据模型

建议新增或重构以下表：

### 1. `redeem_codes`

现有表偏“送时长”，建议扩展成通用权益码：

- `benefit_type`: `wallet_credit` | `rental_hours` | `discount`
- `benefit_value`
- `campaign_id`
- `max_redemptions`
- `redeemed_count`
- `bound_user_id`
- `issued_by`
- `expires_at`

这样 CDK 才能正式承担“充值余额”的职责。

### 2. `crypto_topups`

- `id`
- `user_id`
- `chain`
- `asset`
- `network`
- `deposit_address`
- `expected_amount`
- `received_amount`
- `tx_hash`
- `confirmations`
- `status`
- `quoted_fiat_amount`
- `credited_fiat_amount`
- `created_at`
- `confirmed_at`

### 3. `invite_codes`

- `id`
- `owner_user_id`
- `code`
- `status`
- `created_at`

### 4. `invite_bindings`

- `id`
- `inviter_user_id`
- `invitee_user_id`
- `code`
- `bound_at`
- `status`

约束：

- 每个用户只能绑定一次邀请关系。
- 关系一旦成立，不允许后台随意改写，只能追加审计纠偏事件。

### 5. `referral_rewards`

- `id`
- `inviter_user_id`
- `invitee_user_id`
- `source_type`
- `source_id`
- `reward_rule_version`
- `reward_amount`
- `ledger_entry_id`
- `status`
- `created_at`

### 6. `compliance_profiles`

- `id`
- `name`
- `mode`
- `allowed_tcp_ports`
- `allowed_udp_ports`
- `blocked_port_ranges`
- `dns_policy`
- `allow_package_updates`
- `allow_quic`
- `version`
- `status`

### 7. `rental_compliance_bindings`

- `rental_id`
- `profile_id`
- `applied_version`
- `applied_at`
- `applied_by`

### 8. `audit_events`

建议替代当前偏文本化的 `audit_log`，至少具备：

- `id`
- `event_type`
- `actor_type`
- `actor_id`
- `subject_type`
- `subject_id`
- `payload_json`
- `payload_hash`
- `prev_event_hash`
- `request_id`
- `created_at`

### 9. `audit_anchor_batches`

- `id`
- `environment`
- `from_event_id`
- `to_event_id`
- `event_count`
- `merkle_root`
- `chain_name`
- `tx_hash`
- `anchored_at`
- `status`

## 分阶段路线图

### Phase 0：先收口业务边界

目标：

- 确认是否正式推出“合规模式”。
- 明确 Hysteria2 是否保留。
- 确认 CDK 是只充值余额，还是同时保留送时长。
- 确认邀请码返利规则。

交付：

- 一版规则文档
- 一版字段字典
- 一版事件字典

### Phase 1：用户后台 MVP

优先级最高。

交付：

- 新建 `/console` 用户后台
- 聚合总览接口
- 节点列表
- 钱包总览
- 钱包流水
- 节点剩余时长、账单、探测摘要展示

实现建议：

- 先复用现有 `/api/wallet`、`/api/wallet/ledger`、`/api/rental/:id/*` 能力
- 再补聚合接口，减少前端拼装复杂度

2026-05-06 状态同步：

- Phase 1 MVP 已完成。
- 已落地接口：`GET /api/console/overview`、`GET /api/console/nodes`、`GET /api/console/wallet`、`GET /api/console/audit`、`GET /api/console/referrals`。
- 已落地页面：`/console`、`/console/nodes`、`/console/wallet`、`/console/audit`、`/console/referrals`。
- 前端复用了现有同源代理 `web/app/api/[...path]/route.ts`，没有再新增一套 `web/app/api/console/*` 专用代理。
- Phase 1 之后剩余的账户层工作主要转向虚拟币充值、合规模式和结构化审计；邀请码返余额已完成，统一探测中心已完成，Phase 2 CDK 余额化也已完成。

### Phase 2：把 CDK 正式做成余额充值

2026-05-06 状态：Done

交付：

- [x] CDK 类型从“租期码”扩展成“余额码”
- [x] 后台可以发余额型 CDK
- [x] 前台用户后台支持直接充值余额
- [x] 全量落账本和审计

注意：

- 不建议再把 CDK 直接耦合到某个协议或某个租期
- CDK 最终应该只是钱包入账的一种来源

### Phase 3：统一探测中心

2026-05-06 状态：Done

交付：

- [x] 手工探测和自动交付探测统一列表
- [x] 探测运行增加 `source`、`trigger`、`operator_user_id`
- [x] 管理端支持按来源、结果、节点、租用单过滤
- [x] 用户后台展示自己节点的探测历史摘要

验收：

- [x] 管理员能区分 delivery probe 和 manual probe
- [x] 用户能看到自己节点最近几次探测结果摘要

### Phase 4：邀请码返余额

2026-05-06 状态：Done

交付：

- [x] 用户专属邀请码
- [x] 首次绑定邀请关系
- [x] 首充返利或首单返利
- [x] 奖励进入钱包账本
- [x] 奖励事件进入审计事件流

推荐初版规则：

- 返利触发点为首充和首单，任一首个 qualifying event 只发一次奖励。
- 奖励默认立即结算；邀请人被冻结时进入 held，解冻后再补结。
- 风控命中后冻结奖励，不改写原始事件。

### Phase 5：虚拟货币充值

交付：

- 充值订单
- 收款地址分配
- 链上确认回调
- 法币折算入账
- 失败、超时、短款、重复打款处理

建议：

- 先只做 `USDT` 单链路 MVP，例如 `TRON` 或 `Polygon`
- 不要一开始支持多链多币种
- 先把入账、对账、幂等处理打稳，再做扩展

### Phase 6：节点合规模式

交付：

- `compliance_profiles`
- 节点创建时绑定策略
- 部署脚本改为默认拒绝 + 白名单放行
- 拒绝命中统计和告警
- 管理端可查看策略版本和应用状态

技术重点：

- 优先改 `scripts/vless-reality.sh` 和 `scripts/hysteria2.sh`
- 节点策略版本要和租用单绑定，便于追溯“当时生效的是哪版规则”

2026-05-07 当前状态：

- 已完成：`compliance_profiles`、管理端 CRUD、租用单绑定/释放、`strict` compliance binding、provision 侧 `complianceMode` 传递和协议门控。
- 未完成：公开 profile 列表、RentalWizard 选择控件、Stripe checkout / webhook 贯穿、redeem 前端透传、策略命中统计和状态展示。
- 下一步建议：先补 `GET /api/compliance-profiles` 和购买页选择器，再把 `complianceProfileId` 贯穿到 checkout / redeem 两条入口。
- 待决策：合规模式是否在 UI 上隐藏 Hysteria2，还是保留但在 profile 选择时禁用。

### Phase 7：本地不可篡改审计账本

交付：

- 从 `audit_log` 过渡到结构化 `audit_events`
- 所有关键动作入结构化审计
- 事件 hash chain
- 请求级 trace id

关键事件至少包括：

- 登录、绑定邀请、充值下单、充值确认
- CDK 兑换、返利发放、人工补偿
- 节点创建、探测开始、探测完成、探测失败销毁
- 策略下发、策略拒绝命中
- 续费、销毁、退款、冻结
- 管理员操作

### Phase 8：链上锚定

交付：

- 审计批次 Merkle Root
- Anchor Worker / Cron
- 上链交易回执
- 验证脚本

建议：

- 只上链批次哈希，不上链原始日志
- 选择低成本、生态成熟的链，例如 `Base` 或 `Arbitrum`
- 先做日级锚定，再看是否需要缩短到小时级

## 实施顺序建议

如果你要按投入产出比排优先级，我建议是：

1. 用户后台 MVP
2. CDK 余额化
3. 邀请码返余额
4. 合规模式节点
5. 虚拟币充值
6. 结构化审计账本
7. 链上锚定

原因：

- 用户后台和 CDK 余额化已经落地，邀请返余额是下一批最直接的增长闭环。
- 统一探测中心已完成，不再占用后续优先级。
- 邀请返利和虚拟币充值属于增长和资金扩展，但前提是钱包模型先站稳。
- 审计上链很重要，但应该建立在事件模型稳定之后，否则前面字段一直改，链上锚定会反复返工。

## 不建议现在就做的事

- 不建议把原始明细日志直接上公链。
- 不建议在没有风控和对账能力前就同时开放多链多币种。
- 不建议只靠“封 BT 端口”就宣称实现了严格合规。
- 不建议把邀请返利写成直接改余额而不入账本。
- 不建议继续让用户页围绕单节点页零散扩展，应该直接升级成账户后台。

## 对现有仓库的直接落点

这份规划和当前仓库的关系可以明确映射为：

- `server/src/index.ts`
  - 增加 `/api/console/*`
  - 扩展钱包、邀请、审计、探测统一接口
- `server/src/db/schema.ts`
  - 增加邀请、虚拟币、合规、审计锚定表
- `server/src/wallet-ledger.ts`
  - 升级账本引用模型
- `server/src/probe-observability.ts` 和 `server/src/probe-service.ts`
  - 统一探测来源字段与聚合视图
- `scripts/vless-reality.sh` 和 `scripts/hysteria2.sh`
  - 从黑名单封禁升级为可配置白名单策略
- `web/app` 与 `web/components`
  - 新增用户后台路由和卡片式总览页面
  - 根目录 `app/console/*` 需要做 re-export，接入当前 Next 构建入口

## 最终判断

从当前代码基线看，这个方向不是推倒重来，而是“在已有钱包、探测、计费、审计雏形上做二阶段产品化”：

- 用户后台 MVP、CDK 余额化和统一探测中心都已落地；下一批顺势扩展主要是邀请码返余额。
- 邀请返利需要新增数据模型，但不会破坏现有核心路径。
- 虚拟币充值需要新的资金通道抽象。
- 合规控制和上链审计是新增平台能力，技术上可做，但必须先收紧产品边界，不能靠口头保证。
