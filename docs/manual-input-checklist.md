# 剩余人工补充项清单

Last updated: 2026-05-08

## 范围

这里只保留仍然需要人工提供、人工确认或人工保管的内容。已经在基础平台里覆盖的项不再重复列出。

## 测试服闭环

| 类别 | 待补项 | 建议环境变量名 | 状态 | 要求 |
|---|---|---|---|---|
| 测试链模式 | 测试链环境与白名单邮箱 | `CHAIN_ENVIRONMENT` / `CHAIN_TESTNET_WHITELIST_EMAILS` | 待确认 | 测试服固定 `testnet`，只放行少量测试邮箱 |
| 链上充值 | 充值链与资产 | `CRYPTO_TOPUP_CHAIN` / `CRYPTO_TOPUP_ASSET` | 待确认 | 目前建议 `Base Sepolia + mock USDT` |
| 链上充值 | 确认数 | `CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED` | 待确认 | 当前建议 `12` |
| 链上充值 | RPC 地址 | `CRYPTO_TOPUP_RPC_URL` | 待接入 | 需要稳定 RPC，最好有 SLA 或自建节点 |
| 链上充值 | 收款钱包私钥 | `CRYPTO_TOPUP_SIGNER_PRIVATE_KEY` | 待准备 | 独立钱包，不与锚定钱包复用 |
| 链上充值 | 收款地址 | `CRYPTO_TOPUP_RECEIVER_ADDRESS` | 待确认 | 如不填，可由 signer 私钥推导 |
| 链上充值 | 测试代币合约与 decimals | `CRYPTO_TOPUP_TOKEN_ADDRESS` / `CRYPTO_TOPUP_TOKEN_DECIMALS` | 待确认 | 必须和测试链上的 mock USDT 一致 |
| 链上锚定 | 锚定链与 RPC | `AUDIT_ANCHOR_CHAIN` / `AUDIT_ANCHOR_RPC_URL` | 待确认 | 目前建议与充值链一致 |
| 链上锚定 | 锚定钱包私钥 | `AUDIT_ANCHOR_SIGNER_PRIVATE_KEY` | 待准备 | 必须与充值钱包私钥隔离 |
| 链上锚定 | 锚定目标地址 | `AUDIT_ANCHOR_TARGET_ADDRESS` | 待确认 | 明确写入哪种链上对象 |
| 链上锚定 | Gas 安全阈值 | `AUDIT_ANCHOR_MIN_NATIVE_BALANCE` | 待确认 | 防止余额不足导致锚定停摆 |
| 运维告警 | 充值异常告警 | `CRYPTO_ALERT_WEBHOOK_URL` | 待接入 | 用于歧义匹配和 worker 失败告警 |
| 运维告警 | 锚定异常告警 | `AUDIT_ANCHOR_ALERT_WEBHOOK_URL` | 待接入 | 用于 batch finalize 失败、链上发送失败和回执异常告警 |

## 生产决策

| 类别 | 待决策项 | 说明 |
|---|---|---|
| 虚拟币充值 | 生产链、资产和汇率源 | 需要决定主网、资产类型、汇率来源和对账方式 |
| 虚拟币充值 | 地址托管方式 | 需要决定自持钱包、第三方托管还是混合方案 |
| 审计锚定 | 生产主网和锚定频率 | 需要决定主网、锚定节奏和回执归档方式 |
| 合规模式 | 产品边界 | 需要决定是否作为正式产品线，以及 `Hysteria2` 是否保留 |

## 私钥安全控制

| 控制项 | 最低要求 | 推荐做法 | 禁止做法 |
|---|---|---|---|
| 私钥隔离 | 充值私钥和锚定私钥必须分离 | `CRYPTO_TOPUP_SIGNER_PRIVATE_KEY` 与 `AUDIT_ANCHOR_SIGNER_PRIVATE_KEY` 使用两个独立钱包 | 一个私钥同时负责充值与锚定 |
| 存放位置 | 私钥不得进入 git、示例 env、构建镜像 | 优先用密钥管理器；次选只存在于远端 `.env.selfhosted` | 写入 `.env.selfhosted.example`、`package.json`、脚本默认值 |
| 暴露面 | 仅运行容器所需进程可读 | 将私钥只注入 `api` 容器，避免 `web` 容器持有 | 在前端、日志、调试接口返回私钥 |
| 权限控制 | 只有少数运维人员可查看 | 使用双人审批或最小人数访问控制 | 共用 root shell、多人共享同一明文副本 |
| 日志脱敏 | 所有日志、告警、错误输出都不得包含私钥全文 | 仅记录地址、链、交易 hash、错误摘要 | 打印 env 全量内容、打印签名 payload 中的敏感字段 |
| 轮换策略 | 私钥必须可轮换 | 预留旧地址只读观察窗口，使用版本化 env 轮换 | 永久单密钥不轮换 |
| 钱包余额控制 | 热钱包只保留必要资金 | 单独设置链上 gas 钱包，主资产按低余额运营 | 在同一热钱包长期存大额资产 |
| 备份 | 需要离线加密备份 | 加密后离线保存，至少两份，分地存放 | 明文保存到笔记软件、聊天记录、代码仓库 |
| 测试流程 | 必须先小额验证 | 先跑最小金额充值和最小锚定 batch | 首次上线直接用生产大额资金 |
| 失陷响应 | 必须有吊销和替换流程 | 预先准备“停用旧私钥、迁移新地址、暂停入账/锚定”的 SOP | 私钥疑似泄露后继续使用 |
