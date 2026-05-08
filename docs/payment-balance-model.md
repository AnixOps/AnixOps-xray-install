# AnixOps 支付与余额模型规划

Last updated: 2026-05-08

## 目标决策

租用节点和充值余额必须拆开建模。

| 场景 | 用户看到的选择 | 业务含义 | 推荐后端语义 |
|---|---|---|---|
| 租用节点 | 余额支付 | 从站内钱包余额扣费并部署 | `rentals.payment_method=wallet` |
| 租用节点 | 兑换码 | 验证兑换码后部署 | `rentals.payment_method=redeem_code` |
| 余额充值 | Stripe | 用 Stripe 给站内余额充值 | `topups.provider=stripe` |
| 余额充值 | 钱包支付 | 用测试链/正式链加密货币充值余额 | `crypto_topups.rail=wallet` |
| 余额充值 | X402 | 用 X402 标记的支付通道充值余额 | `crypto_topups.rail=x402` |

短期内，测试服的 `钱包支付` 和 `X402` 可以复用同一套 Base Sepolia mock USDT 充值确认链路，但必须在记录层保留 rail/source 标记，避免以后无法对账。

## 变更背景

在支付模型收口之前，租用向导把 `Stripe`、`wallet`、`x402`、`redeem` 都当成租用支付方式。按钮启用条件是：

```text
已选协议 + 已选套餐 + 已填邮箱 + 已选支付方式 + 合规策略可用
```

如果选择 `兑换码`，还额外要求兑换码先验证通过。

这个模型的问题是：`Stripe`、钱包支付和 `X402` 实际上更适合作为余额充值入口，而不是直接作为租用支付方式。用户应该先充值余额，再用余额租用；兑换码作为另一条独立授权路径。

## 目标交互

### 租用页

租用页只展示两种支付模式：

- `余额支付`
- `兑换码`

按钮状态：

| 模式 | 按钮启用条件 | 失败提示 |
|---|---|---|
| 余额支付 | 协议、套餐、邮箱完整，且合规策略可用 | 点击后如果余额不足，提示去充值 |
| 兑换码 | 协议、邮箱、合规策略可用，且兑换码验证通过 | 兑换码无效、过期或已使用 |

余额不足不应该表现为按钮长期灰掉。应该允许用户提交并收到明确的余额不足错误，同时提供去充值入口。

### 余额充值页

钱包/控制台中提供余额充值区域：

| 充值方式 | 当前测试服行为 | 后续生产行为 |
|---|---|---|
| Stripe | Stripe checkout 后写入钱包账本 | 保持 |
| 钱包支付 | Base Sepolia mock USDT 充值，白名单可用 | 正式链 USDT/USDC 或稳定币 |
| X402 | 先复用测试链充值确认，记录 `rail=x402` | 接入真实 X402 支付/结算能力 |

测试服必须显示测试链标注，例如：

```text
当前为 Base Sepolia 测试链，仅供内部白名单用户测试使用。
```

## API 规划

### 租用

`POST /api/rental`

目标请求：

```json
{
  "protocol": "vless-reality",
  "durationHours": 1,
  "paymentMethod": "wallet",
  "complianceProfileId": "standard"
}
```

目标规则：

- 只接受 `paymentMethod=wallet`。
- 兑换码继续走 `POST /api/redeem`。
- 不再接受新的 `stripe` 或 `x402` 租用请求。
- 历史 `stripe` / `x402` rental 和 payment 记录仍保持可读。

### Stripe 充值

`POST /api/wallet/topups/checkout`

保持当前语义：

```json
{
  "amount": 10,
  "currency": "usd",
  "provider": "stripe"
}
```

### 链上充值 / X402 充值

`POST /api/wallet/crypto-topups`

目标请求：

```json
{
  "fiatAmount": 10,
  "asset": "USDT",
  "network": "base-sepolia",
  "rail": "wallet"
}
```

`rail` 可选值：

- `wallet`
- `x402`

测试服 `CHAIN_ENVIRONMENT=testnet` 时，服务端仍应固定链、资产、收款地址和 token 合约，不信任客户端传入的链参数。

## 数据模型规划

| 表 | 字段 | 目标 |
|---|---|---|
| `rentals` | `payment_method` | 新租用只写 `wallet` 或 `redeem_code` |
| `payments` | `method` | 保留历史兼容，新记录只写 `wallet` 或 `redeem_code` |
| `topups` | `provider` | `stripe` 保持作为法币充值 |
| `crypto_topups` | `rail` | 新增，区分 `wallet` 和 `x402` |
| `wallet_ledger` | `type` | 继续承接 `topup`、`crypto_topup`、`billing_charge` 等余额流水 |

生产迁移时不要删除历史 `payments.method=stripe` 或 `payments.method=x402`。展示层应能读旧记录，但新入口不再创建这种租用付款记录。

## 实施顺序

下面记录这次收口的实施路径。代码和文档层面的收口已经到位，白名单测试链的实跑验收已在 2026-05-08 通过 `scripts/recharge-smoke.js` live run 完成，后续回归仍复用该脚本。

| 顺序 | 工作 | 验收标准 |
|---|---|---|
| 1 | 租用页只保留 `余额支付` / `兑换码` | 用户不会再在租用页看到 Stripe、钱包支付、X402 三个充值通道 |
| 2 | 调整租用按钮状态和错误提示 | 余额模式表单完整即可提交；余额不足返回明确充值提示 |
| 3 | 后端 `/api/rental` 收口为余额扣费 | 新租用不再接受 `stripe` 或 `x402` 作为直接付款方式 |
| 4 | 钱包/控制台新增充值入口 | Stripe、钱包支付、X402 都在余额充值区域出现 |
| 5 | `crypto_topups` 增加 rail/source 标记 | 钱包充值和 X402 充值可以独立统计和对账 |
| 6 | 更新后台与支付历史展示 | 历史租用付款和新充值记录语义清晰 |
| 7 | 自托管部署测试 | Base Sepolia 白名单用户可以完成充值、余额扣费、兑换码部署两条路径；已在 `scripts/recharge-smoke.js` live run 中完成验收 |

## 安全和运营约束

- 测试服链上充值只对白名单邮箱开放。
- 不在前端、日志、文档或 git 中写入私钥。
- 测试链和正式链使用两套独立 env。
- `wallet` 和 `x402` 即使短期复用同一条测试链，也必须保留来源标记。
- 所有余额入账必须落到 `wallet_ledger`，不能只改用户余额字段。
- 所有租用扣费必须有幂等 key 或等价防重机制。
