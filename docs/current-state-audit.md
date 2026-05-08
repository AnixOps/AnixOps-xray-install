# AnixOps 当前未完成事项

Last updated: 2026-05-09

## 说明

这里只保留仍然需要推进的内容。基础平台、自托管运行时、钱包账本、探测、审计、scheduler 和测试已经完成，不再重复展开。

P0 测试服充值闭环已在 2026-05-08 的 `scripts/recharge-smoke.js` live run 中验收完成。

2026-05-09 的 `node scripts/remote-ops.js audit-anchor-smoke` 已验证审计锚定 synthetic 闭环，batch、receipt 和 verify 都通过。

用户侧钱包控制台也已经规范化：首页保留 `Console Wallet` 登录入口，普通用户可以通过邮箱魔法链接进入 `/console/wallet`，链上充值单会明确展示精确到账金额、网络、过期时间、状态和复制按钮，并对待确认单据自动轮询。

管理端充值/链上充值/钱包流水的统一钻取面板也已经补齐，topup 记录可以直接打开统一详情卡查看关联钱包流水。

## 外部依赖

| 能力 | 状态 | 说明 |
|---|---|---|
| 真实链上充值 provider | Missing | 还需要真实地址分配、确认监听、汇率源和对账流程 |
| 审计 anchor 测试链实跑与生产化 | Partial | 管理端已展示 anchor batch、txHash、receipt summary、recovery hint，并支持 verify；2026-05-09 已通过 `node scripts/remote-ops.js audit-anchor-smoke` 的 synthetic 闭环实跑，且恢复入口已补成 `node scripts/remote-ops.js audit-anchor-recover <txHash>`，仍需生产主网方案 |
| 合规统计更细展示 | Partial | 管理端和控制台已展示 profile、blocked protocol、reject stats 和 sync coverage；仍可继续补导出、告警和更细的用户端统计 |

## 需要决策

| 事项 | 状态 | 决策点 |
|---|---|---|
| 合规模式产品边界 | Decision Needed | 是正式产品线，还是安全增强 profile |
| Hysteria2 在合规模式中的角色 | Decision Needed | 当前 restricted profile 已禁用，是否继续保留 |
| 虚拟币充值生产链路 | Decision Needed | 生产主网、资产、汇率源和托管方式 |
| 链上锚定生产链路 | Decision Needed | 生产主网、钱包托管方式、锚定频率和归档方式 |

## 参考

- 需要人工补充的输入见 [manual-input-checklist.md](/root/code/AnixOps-xray-install/docs/manual-input-checklist.md)
- 仍需推进的实现差距见 [implementation-gap-checklist.md](/root/code/AnixOps-xray-install/docs/implementation-gap-checklist.md)
