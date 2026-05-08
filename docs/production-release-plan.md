# AnixOps 正式版 V1 规划

Last updated: 2026-05-09

## 目标

正式版首发不依赖 `Stripe` 申请结果，不上线额外的链上充值渠道，先把充值入口收口成可配置的 `CDK` 兑换码体系。

这个版本只做两件事：

1. 让站点支持可配置的充值/授权渠道，但首发只启用 `CDK`。
2. 把 `CDK` 拆成两个业务版本：
   - `余额直充型`：兑换后进入钱包余额，后续仍用余额支付租用。
   - `单次型`：兑换后直接生成一次租用，等同于现在的单次兑换码。

## 正式版范围

| 模块 | 首发状态 | 说明 |
|---|---|---|
| 外部充值渠道 | 仅 `CDK` | `Stripe` 未申请前不作为生产可见入口 |
| 余额直充型兑换码 | 保留 | 兑换后写入 `wallet_ledger`，余额可继续用于租用 |
| 单次型兑换码 | 保留 | 兑换后直接创建租用，沿用当前单次码逻辑 |
| 钱包余额租用 | 保留 | 余额足够时继续作为租用支付方式 |
| 链上充值 | 暂缓 | 继续保留在测试/后续版本，不进入正式版首发 |
| X402 | 暂缓 | 不进入正式版首发入口 |

## 渠道设计

正式版需要一个可配置的渠道注册表，但首发只启用两个 `CDK` 子类型。

建议的配置语义：

```yaml
runtime:
  NEXT_PUBLIC_RELEASE_PROFILE: formal
recharge_channels:
  - key: cdk_wallet
    enabled: true
    code_type: wallet
    label: 余额直充型
    settlement_target: wallet_ledger
  - key: cdk_duration
    enabled: true
    code_type: duration
    label: 单次型
    settlement_target: rental
  - key: stripe
    enabled: false
    label: Stripe
    reason: not_applied
```

核心原则：

- 渠道配置是元数据，不把支付能力硬编码进页面逻辑。
- 生产环境默认只读可见 `CDK`。
- 后续如果申请到 `Stripe`，只需要把渠道开关打开，不改业务语义。

## 两种版本

### 1. 余额直充型

用户拿到一个 `CDK`，兑换后直接增加钱包余额。

适用场景：

- 想先充值，再按需租用。
- 想做批量发放、福利发放、内部测试发码。

系统结果：

- `redeem_codes.code_type = wallet`
- `redeem_codes.wallet_amount` 必填
- 兑换后写入 `wallet_ledger`
- 用户后续通过 `wallet` 支付租用

### 2. 单次型

用户拿到一个 `CDK`，兑换后直接创建一次租用。

适用场景：

- 单次授权
- 试用码
- 赠送码

系统结果：

- `redeem_codes.code_type = duration`
- `redeem_codes.duration_hours` 必填
- 兑换后直接创建 `rental`
- 不经过钱包余额

## 页面与交互

正式版首页和控制台的推荐表现：

- 首页保留登录入口。
- 充值相关入口只展示 `CDK`。
- 余额版用户在控制台里看到余额、兑换码记录和租用记录。
- 单次型用户在兑换后直接看到节点详情和订阅链接。
- 不展示 `Stripe` checkout 入口，也不把它作为默认充值方式。
- 正式版由 `NEXT_PUBLIC_RELEASE_PROFILE=formal` 驱动，tag 发布时默认启用。
- 部署时需要把 `NEXT_PUBLIC_RELEASE_PROFILE` 同时传给 `web` 的 build arg 和运行时环境。

## 数据模型

正式版首发沿用现有兑换码 schema：

- `redeem_codes.code_type = duration | wallet`
- `redeem_codes.wallet_amount` 仅对余额直充型生效
- `redeem_codes.duration_hours` 仅对单次型生效
- `wallet_ledger` 仍然是真正的余额真相源

历史数据保留：

- 旧的 `stripe`、`wallet`、`x402` 支付记录继续可读
- 首发生产版不再新增这些入口记录

## 发布顺序

1. 冻结正式版首发范围，只保留 `CDK` 两种类型。
2. 把充值入口改成配置驱动，默认只暴露 `CDK`。
3. 校验余额型和单次型兑换码的生成、验证、兑换和审计。
4. 清理生产 UI 里的 `Stripe`、链上充值和其他未启用入口。
5. 用 tag 发布正式版快照，不单独长期维护一个 `production` 分支。

## 推荐版本管理

- `main` 继续作为集成主线。
- 正式版发布使用 tag，例如 `prod-v1.0.0`、`prod-v1.1.0`。
- 如果需要一段稳定窗口，可以临时开 `release/prod-v1`，但不建议长期存在。

## 验收标准

- 生产 UI 里没有 `Stripe` 可点击入口。
- 只有 `CDK` 作为对外充值/授权入口。
- `CDK` 有两个明确子类型：余额直充型和单次型。
- 余额型兑换后能正常进入钱包余额，再走钱包租用。
- 单次型兑换后能直接进入节点详情和订阅链接。
- 历史支付记录仍可查看，但不影响新版本入口。
