# AnixOps 长期 API 规划

Last updated: 2026-05-08

## 说明

这里仅保留仍然需要推进的生产化事项和待决策边界。

当前状态基线见 [docs/current-state-audit.md](/root/code/AnixOps-xray-install/docs/current-state-audit.md)，实施差距见 [docs/implementation-gap-checklist.md](/root/code/AnixOps-xray-install/docs/implementation-gap-checklist.md)。

## 仍需推进的事项

| 事项 | 当前状态 | 仍缺什么 |
|---|---|---|
| 真实链上充值 provider | Partial | 真实地址托管、确认监听、汇率源、对账、失败重试 |
| 审计锚定测试链闭环 | Partial | 自托管 scheduler 常驻、首笔测试链交易、`txHash` / receipt 恢复 runbook |
| 合规统计与运营视图 | Partial | 更细的管理端和用户端统计、导出和告警 |
| Worker 版 API 去留 | Decision Needed | `web/workers/index.ts` 是否继续保留，还是迁移/删除 |

## 需要继续确认的决策

- 合规模式是否作为正式产品线，还是仅作为安全增强 profile。
- 合规模式下是否继续保留 `Hysteria2`。
- 生产环境虚拟币充值选择哪条主网、哪种资产和哪套托管方式。
- 生产环境链上锚定选择哪条主网、锚定频率和归档方式。

## 运行约束

- 测试服默认链路固定为 `Base Sepolia + mock USDT + 白名单邮箱`。
- 自托管默认调度由 `scheduler` 容器承接。
- `Vultr` 继续作为默认 provider，`DigitalOcean` 和 `AWS` 保持可切换。
