# EVM 测试链落地步骤

Last updated: 2026-05-08

## 目标

这份文档给出一套可以直接执行的 EVM 测试链方案，用于测试服：

- 首选链：`Base Sepolia`
- 备选链：`Polygon Amoy`
- 充值资产：`USDT`（测试服使用 `mock USDT`）
- 锚定链：与充值链保持一致
- 确认数：`12`

说明：

- 我不能替你直接“申请”测试链钱包或 faucet 余额，因为这需要你自己的钱包地址，有些 faucet 还会做资格检查。
- 但这套流程不复杂，按下面做即可。
- 所有命令都要从 `AnixOps-xray-install` 仓库根目录执行；如果报 `Cannot find module 'ethers'` 或 `Cannot find module 'solc'`，先执行一次 `npm install`。

## 推荐链选择

| 场景 | 推荐链 | 原因 |
|---|---|---|
| 你只想最快拿到测试 gas | `Base Sepolia` | 一般比 Amoy faucet 门槛更低 |
| 你已经拿到 Amoy faucet | `Polygon Amoy` | 当前代码默认示例和文档最早基于它 |

## 官方网络参数

### Base Sepolia

| 项目 | 值 |
|---|---|
| Network name | `Base Sepolia` |
| Chain ID | `84532` |
| Gas token | `ETH` |
| RPC URL | `https://sepolia.base.org` |
| Explorer | `https://sepolia.basescan.org/` |

### Polygon Amoy

| 项目 | 值 |
|---|---|
| Network name | `Amoy` |
| Chain ID | `80002` |
| Gas token | `POL` |
| RPC URL | `https://rpc-amoy.polygon.technology` |
| 备用公共 RPC | `https://polygon-amoy.drpc.org` |
| Explorer | `https://amoy.polygonscan.com/` |

参考：

- Polygon 官方 RPC 文档：`docs.polygon.technology/pos/reference/rpc-endpoints`
- Polygon 官方钱包网络配置文档：`docs.polygon.technology/tools/wallets/metamask/add-polygon-network`

## 你需要准备的东西

| 用途 | 需要你人工准备 | 备注 |
|---|---|---|
| 测试充值 | 一个测试链收款钱包 | 用于接收 mock USDT |
| 测试锚定 | 一个测试链锚定钱包 | 建议和充值钱包分离 |
| Gas | 两个钱包都需要测试链原生 gas | Base 是 `ETH`，Amoy 是 `POL` |
| 充值代币 | 一份 mock `USDT` 合约 | 测试服不要直接依赖真实稳定币 |
| 白名单 | 一组测试邮箱 | 只有这些邮箱可以调用链上功能 |

## 最快路径

如果你想尽量少走人工步骤，优先用一条 bootstrap 命令：

```bash
# 生成钱包并直接写回本地 .env.selfhosted
node scripts/bootstrap-evm-testnet.js \
  --chain base-sepolia \
  --whitelist-emails qa1@example.com,qa2@example.com \
  --write-env
```

如果你已经有一个带测试 gas 的 deployer key，也可以一步把 mock USDT 部署掉并把 token 地址直接填进输出 env：

```bash
node scripts/bootstrap-evm-testnet.js \
  --chain base-sepolia \
  --whitelist-emails qa1@example.com,qa2@example.com \
  --deploy-mock-usdt \
  --deployer-private-key <funded-testnet-private-key> \
  --json
```

这个脚本会复用现有能力，按当前环境输出：

- `topup wallet`
- `anchor wallet`
- 可直接贴进 `.env.selfhosted` 的链配置
- 如果带 `--write-env`，会直接更新本地 `.env.selfhosted`
- 如果加了 `--deploy-mock-usdt`，还会直接填好 `CRYPTO_TOPUP_TOKEN_ADDRESS`

## 步骤 6：跑充值闭环验收

在测试链和 `mock USDT` 都准备好以后，先用新的充值验收脚本做一轮端到端检查：

```bash
node scripts/recharge-smoke.js \
  --env .env.selfhosted \
  --email qa1@example.com \
  --confirmation-mode auto
```

说明：

- 如果你只想验证非链路的充值和租用流程，可以把 `--confirmation-mode auto` 改成 `synthetic`。
- 如果要验证真实测试链转账，保持 `auto`，并确保 `CRYPTO_TOPUP_RPC_URL`、`CRYPTO_TOPUP_SIGNER_PRIVATE_KEY`、`CRYPTO_TOPUP_TOKEN_ADDRESS` 和 `CRYPTO_TOPUP_TOKEN_DECIMALS` 已配置。
- 远端执行时也可以直接跑 `node scripts/remote-ops.js recharge`。

注意：

- CLI 参数优先用 `--env` 或 `--file`，不要再把 `node ... --env-file ...` 当作脚本参数示例；在 Node 22 下这个参数名会先被 Node 运行时消费。

## 步骤 1：创建两个测试钱包

建议创建两个独立钱包：

1. `topup wallet`
   用于测试充值收款地址。
2. `anchor wallet`
   用于测试审计锚定交易。

要求：

- 不要复用主网钱包。
- 不要让充值和锚定共用同一个私钥。
- 先保存好助记词或私钥，再往下走。

如果你不想手动建钱包，仓库里已经有生成脚本：

```bash
# Run from the AnixOps project root
node scripts/generate-testnet-wallets.js --whitelist-emails qa1@example.com,qa2@example.com
```

这个脚本会一次生成：

- `topup wallet`
- `anchor wallet`
- 一段可以直接贴进 `.env.selfhosted` 的配置片段

## 步骤 2：把测试链加到钱包

最简单的方法：

1. 选定你要用的链：`Base Sepolia` 或 `Polygon Amoy`
2. 添加到 MetaMask

手动参数：

```text
Base Sepolia
Network Name: Base Sepolia
RPC URL: https://sepolia.base.org
Chain ID: 84532
Currency Symbol: ETH
Block Explorer URL: https://sepolia.basescan.org/

Polygon Amoy
Network Name: Polygon Amoy
RPC URL: https://rpc-amoy.polygon.technology
Chain ID: 80002
Currency Symbol: POL
Block Explorer URL: https://amoy.polygonscan.com/
```

## 步骤 3：领取测试 gas

如果走 `Base Sepolia`：

- 领测试 `ETH`
- 通常 faucet 门槛更低

如果走 `Polygon Amoy`：

- 领测试 `POL`

已知点：

- faucet 经常有限流或资格检查
- 有些会要求主网活跃度或余额

建议：

1. 给 `topup wallet` 领一次测试 gas。
2. 给 `anchor wallet` 领一次测试 gas。
3. 到对应 explorer 确认到账。

如果 Alchemy faucet 不放行，再换：

- QuickNode
- GetBlock
- StakePool

## 步骤 4：部署一个 mock USDT

测试服建议自己部署一个最简单的 ERC-20 来模拟 `USDT`。

仓库里已经带了：

- 合约文件：[contracts/MockUSDT.sol](/root/code/AnixOps-xray-install/contracts/MockUSDT.sol:1)
- 部署脚本：[deploy-mock-usdt.js](/root/code/AnixOps-xray-install/scripts/deploy-mock-usdt.js:1)

推荐直接用脚本部署：

```bash
# Run from the AnixOps project root
node scripts/deploy-mock-usdt.js \
  --chain base-sepolia \
  --private-key <topup-wallet-private-key> \
  --recipient <topup-wallet-address> \
  --amount 100000 \
  --json
```

说明：

- `--amount 100000` 表示 mint `100000 USDT`
- 合约 decimals 固定为 `6`
- 你也可以不传 `--recipient`，先只部署，再单独 mint
- 如果你是手动在钱包里发 mint 交易，把 gas limit 设到 `100000` 以上；这类调用在 Base Sepolia 上通常会估到 `70000` 左右，默认低值容易直接回滚。

如果你更习惯图形界面，也可以把 [MockUSDT.sol](/root/code/AnixOps-xray-install/contracts/MockUSDT.sol:1) 直接导入 Remix 部署。

Linux 上也可以直接用仓库里的包装脚本：

```bash
bash scripts/mint-mock-usdt.sh \
  --chain base-sepolia \
  --amount 1000000
```

部署后你需要记住：

- 合约地址
- decimals（这里是 `6`）

## 步骤 5：把测试链配置填到测试服

把下面这些值填进远端 `.env.selfhosted`：

```env
CHAIN_ENVIRONMENT=testnet
CHAIN_TESTNET_WHITELIST_EMAILS=qa1@example.com,qa2@example.com

CRYPTO_TOPUP_CHAIN=base
CRYPTO_TOPUP_ASSET=USDT
CRYPTO_TOPUP_CONFIRMATIONS_REQUIRED=12
CRYPTO_TOPUP_RPC_URL=https://sepolia.base.org
CRYPTO_TOPUP_SIGNER_PRIVATE_KEY=<topup wallet private key>
CRYPTO_TOPUP_RECEIVER_ADDRESS=<topup wallet address>
CRYPTO_TOPUP_TOKEN_ADDRESS=<mock usdt contract address>
CRYPTO_TOPUP_TOKEN_DECIMALS=6

AUDIT_ANCHOR_CHAIN=base
AUDIT_ANCHOR_RPC_URL=https://sepolia.base.org
AUDIT_ANCHOR_SIGNER_PRIVATE_KEY=<anchor wallet private key>
AUDIT_ANCHOR_TARGET_ADDRESS=<anchor wallet address or a dedicated anchor target>
AUDIT_ANCHOR_MIN_NATIVE_BALANCE=0
```

## 步骤 6：重启测试服

填完后，测试服重启一轮：

```bash
node scripts/remote-ops.js deploy
```

然后验收：

```bash
node scripts/remote-ops.js health --strict
node scripts/remote-ops.js smoke
```

## 步骤 7：跑第一笔测试充值

流程：

1. 用白名单邮箱注册并登录测试服。
2. 调 `POST /api/wallet/crypto-topups` 创建一笔充值订单。
3. 记录返回的 `topup.id`、`address` 和 `expectedAmount`。
4. 用持有 mock USDT 的测试钱包，向该地址转一笔 token，金额以返回的 `expectedAmount` 为准。
5. 如果你想手动确认，拿到交易 hash 后运行：

```bash
node scripts/crypto-topup-confirm.js --topup-id <topup-id> --tx-hash <tx-hash>
```

如果你想走自动确认，直接跑一次 worker：

```bash
node scripts/crypto-topup-worker.js --json
```

如果测试链配置完整，worker 会扫描最近区块中的 ERC20 Transfer，找到可以唯一匹配的 pending topup，然后自动调用内部确认接口入账。

如果你想直接从本地运维机触发远端 worker，而不是先 SSH 到测试服，也可以用：

```bash
node scripts/remote-ops.js job crypto-topups
```

## 步骤 8：跑第一笔测试锚定

先创建一批未锚定事件，然后运行：

```bash
node scripts/audit-anchor-worker.js
```

如果测试链配置完整，这个脚本会：

1. 先创建本地 batch
2. 标记 batch 进入 submission window
3. 用测试链钱包发一笔携带 `merkleRoot` 的交易
4. 立刻把 `chain` / `txHash` 持久化到 batch
5. 等待 receipt 后 finalize，并归档 `receipt`

如果 batch 已经记录了 `txHash`，下一次 worker 会优先查询 receipt 并自动 finalize，不会直接再发第二笔链上交易。

如果 worker 告警里没有落库 `txHash`，但你从 explorer 或 RPC 日志确认链上交易已经发出，这时优先复用原交易 hash 做人工恢复，不要直接再发第二笔链上交易：

```bash
node scripts/audit-anchor-worker.js --tx-hash <existing-tx-hash> --json
```

校验：

```bash
node scripts/verify-audit-anchor.js <batch-id>
```

## 安全要求

- 测试链私钥也不要写进 git。
- `topup wallet` 和 `anchor wallet` 必须分离。
- 测试链只对白名单邮箱开放。
- 不要在测试服混用主网地址和主网私钥。

## 当前现实约束

只要你没有完成下面两件事，就还不能跑第一笔真实测试链交易：

1. 领到测试链 gas（Base 是 `ETH`，Amoy 是 `POL`）
2. 部署并 mint 一份 mock `USDT`

也就是说，“申请测试链”本身不难，真正耗时的是把测试钱包、测试 gas 和 mock 资产准备好。
