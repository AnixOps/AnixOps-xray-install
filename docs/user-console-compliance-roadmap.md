# AnixOps 用户后台与合规闭环路线图

Last updated: 2026-05-08

## 说明

这里仅保留还没有收口的产品项、实现缺口和决策点。

用户侧钱包控制台已经标准化并上线：首页保留 `Console Wallet` 登录入口，普通用户可通过邮箱魔法链接进入 `/console/wallet`，充值单会展示精确到账金额、网络、过期时间、状态和复制按钮。

## 仍需推进的产品项

| 模块 | 状态 | 还缺什么 |
|---|---|---|
| 真实链上虚拟币充值 | Partial | 用户侧 Console Wallet 充值流程已完成；还缺真实 provider、deposit address 管理、确认监听、汇率和对账 |
| 合规模式产品边界 | Decision Needed | 是否作为正式产品线，标准节点与合规模式如何分层，`Hysteria2` 是否保留 |
| 链上锚定 | Partial | 用户侧充值体验已完成；还缺测试链闭环、调度器常驻、生产链选择、失败恢复 runbook |
| 合规统计展示 | Partial | 更细的管理端和用户端统计、导出、告警 |

## 仍需确认的决策

- 合规模式是否只做安全增强，还是独立产品线。
- 合规模式是否默认禁用或隐藏 `Hysteria2`。
- 充值生产链路选哪条主网，锚定生产链路选哪条主网。
- 虚拟币充值和审计锚定是否先统一在测试链跑通再放开生产链。

## 保留的设计约束

- 钱包账本继续作为余额真相源，任何入账都必须落到 ledger。
- 测试服默认固定为 `Base Sepolia + mock USDT + 白名单邮箱`。
- 私钥必须分离、脱敏、最小权限注入，充值私钥和锚定私钥不能复用。

## 参考

- [docs/manual-input-checklist.md](/root/code/AnixOps-xray-install/docs/manual-input-checklist.md)
- [docs/current-state-audit.md](/root/code/AnixOps-xray-install/docs/current-state-audit.md)
- [docs/implementation-gap-checklist.md](/root/code/AnixOps-xray-install/docs/implementation-gap-checklist.md)
