# AnixOps 剩余实施差距清单

Last updated: 2026-05-09

## 目的

这份清单只保留当前仍需推进的工作项。已完成的基础能力不再重复列出，基线以 [current-state-audit.md](/root/code/AnixOps-xray-install/docs/current-state-audit.md) 为准。

测试服充值闭环已在 2026-05-08 的 `scripts/recharge-smoke.js` live run 中验收完成，因此不再列入剩余工作。

用户侧 Console Wallet 充值流程已经标准化并上线。这里剩下的主要是后台汇总、生产化链路和更细的审计 / 合规展示。

后台充值钻取已经补齐：fiat topup、crypto topup 和 wallet ledger 可以在管理端统一查看详情。

## 剩余工作

| 工作项 | 当前状态 | 当前缺口 | 优先级 |
|---|---|---|---|
| 真实链上充值生产化 | Partial | 生产链、资产、真实 provider、确认监听、汇率源和对账未接 | P2 |
| 审计 anchor 生产闭环 | Partial | 管理端已显示 anchor batch、`txHash`、receipt summary、recovery hint，并支持 verify；2026-05-09 已跑通 `node scripts/remote-ops.js audit-anchor-smoke` 的 synthetic 闭环，恢复入口已补成 `node scripts/remote-ops.js audit-anchor-recover <txHash>`，仍缺生产主网决策 | P1 |
| 合规统计更细展示 | Partial | 管理端和控制台已展示 profile、blocked protocol、reject stats 和 sync coverage；仍可继续补导出、告警和更细的用户端统计 | P2 |

## 需要先决策的问题

正式版 V1 的充值通道已经收口到 `CDK` 兑换码，两种首发形态分别是 `wallet` 余额直充型和 `duration` 单次型。`Stripe`、链上钱包充值和 `X402` 不进入首发，保留为后续版本选项。

- 合规模式是否是正式产品线，还是仅作为安全增强选项。
- 合规模式下是否隐藏或禁用 `Hysteria2`。
- 生产环境虚拟币充值支持哪条主网、哪种资产和汇率源。
- 生产环境链上锚定选择哪条主网、锚定频率和钱包托管方式。

## 运行约束

- 测试服默认链路固定为 `Base Sepolia + mock USDT + 白名单邮箱`。
- 自托管默认调度由 `scheduler` 容器承接。
- `Vultr` 继续作为默认 provider，`DigitalOcean` 和 `AWS` 保持可切换。
