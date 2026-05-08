# AnixOps 剩余实施差距清单

Last updated: 2026-05-08

## 目的

这份清单只保留当前仍需推进的工作项。已完成的基础能力不再重复列出，基线以 [current-state-audit.md](/root/code/AnixOps-xray-install/docs/current-state-audit.md) 为准。

测试服充值闭环已在 2026-05-08 的 `scripts/recharge-smoke.js` live run 中验收完成，因此不再列入剩余工作。

用户侧 Console Wallet 充值流程已经标准化并上线。这里剩下的主要是后台钻取、汇总、生产化链路和更细的审计 / 合规展示。

## 剩余工作

| 工作项 | 当前状态 | 当前缺口 | 优先级 |
|---|---|---|---|
| 支付和充值后台展示 | Partial | 用户侧 Console Wallet 流程已完成；管理端已拆出 payment、fiat topup、crypto topup、wallet ledger 和 audit anchor batch 视图，但更完整的钻取和汇总还需要继续补齐 | P1 |
| 真实链上充值生产化 | Partial | 生产链、资产、真实 provider、确认监听、汇率源和对账未接 | P2 |
| 审计 anchor 生产闭环 | Partial | 管理端已显示 anchor batch、`txHash`、receipt summary、recovery hint，并支持 verify；已补 smoke 脚本，远端测试链闭环、`txHash` 失落后的恢复 SOP、生产主网决策未完成 | P1 |
| 合规统计更细展示 | Partial | 管理端和控制台已展示 profile、blocked protocol、reject stats 和 sync coverage；仍可继续补导出、告警和更细的用户端统计 | P2 |

## 需要先决策的问题

- 合规模式是否是正式产品线，还是仅作为安全增强选项。
- 合规模式下是否隐藏或禁用 `Hysteria2`。
- 生产环境虚拟币充值支持哪条主网、哪种资产和汇率源。
- 生产环境链上锚定选择哪条主网、锚定频率和钱包托管方式。

## 运行约束

- 测试服默认链路固定为 `Base Sepolia + mock USDT + 白名单邮箱`。
- 自托管默认调度由 `scheduler` 容器承接。
- `Vultr` 继续作为默认 provider，`DigitalOcean` 和 `AWS` 保持可切换。
