# AnixOps API Field Dictionary

Last updated: 2026-05-08

## Purpose

This file records the current stable payload shapes that were added during the wallet, console, compliance, referral, crypto topup, and audit expansion work.

It is not a generated OpenAPI spec. It is the human-maintained contract summary used by product, frontend, and operations.

## Console

### `GET /api/console/overview`

- `user.email`: current signed-in email.
- `user.isAdmin`: whether the session email is in `ADMIN_EMAILS`.
- `wallet.balance`: current wallet balance.
- `wallet.currency`: current wallet currency, currently `usd`.
- `summary.totalRentals`: rentals ever created by the user.
- `summary.activeRentals`: rentals in `active`.
- `summary.provisioningRentals`: rentals still being delivered.
- `summary.expiringSoonRentals`: rentals close to `expiresAt`.
- `summary.totalPaid`: total historical direct payment amount.
- `recentRentals[]`: latest rental summaries shown in the console.
- `recentPayments[]`: latest payment-compatible entries.
- `recentAuditEntries[]`: latest legacy `audit_log` entries.

### `GET /api/console/nodes`

- `nodes[].id`: rental id.
- `nodes[].protocol`: `vless-reality` or `hysteria2`.
- `nodes[].status`: rental lifecycle state.
- `nodes[].ip`: delivered public IP when present.
- `nodes[].paymentMethod`: `stripe`, `wallet`, `redeem_code`, or admin/debug paths.
- `nodes[].remainingMinutes`: minutes until expiry for active rentals.
- `nodes[].probeSummary.status`: summary of latest probe run.
- `nodes[].probeSummary.decision`: `pass`, `fail`, `skipped`, or `unknown`.

### `GET /api/console/wallet`

- `wallet.balance`: current wallet balance.
- `wallet.available`: currently same as balance because reserved funds are not modeled separately.
- `topups[]`: Stripe wallet topups from `topups`.
- `cryptoTopups[]`: crypto topup orders from `crypto_topups`.
- `ledgerEntries[]`: append-only wallet entries from `wallet_ledger`, or legacy payment mapping when no ledger rows exist.
- `ledgerSource`: `wallet-ledger` or `legacy-payments`.

### `GET /api/console/audit`

- `auditEntries[]`: recent legacy `audit_log` rows tied to the user's rentals.
- `compliance.status`: current compliance section status.
- `compliance.profiles[]`: active compliance profiles.
- `compliance.rentals[]`: per-rental compliance binding summary.
- `structuredEvents[]`: latest structured `audit_events` visible to the user scope.

### `GET /api/console/referrals`

- `inviteCode`: inviter code owned by the current user.
- `binding`: invite binding for the current user as invitee, if any.
- `summary.invitedUsers`: distinct invitees bound to the current inviter.
- `summary.rewardedAmount`: already credited referral rewards.
- `summary.pendingAmount`: held rewards waiting for inviter unfreeze.
- `rewards[]`: latest referral reward rows.

## Wallet

### `GET /api/wallet`

- `userId`: current user id.
- `balance`: current balance.
- `currency`: current balance currency.
- `reserved`: currently `0`.
- `available`: `max(balance - reserved, 0)`.
- `source`: `wallet-ledger` or `legacy-user-balance`.

### `GET /api/wallet/ledger`

- `entries[].type`: wallet event type such as `topup`, `crypto_topup`, `redeem_code_credit`, `referral_reward`, `billing_charge`, `admin_credit`, or legacy mapping types.
- `entries[].amount`: signed money delta.
- `entries[].balanceAfter`: wallet balance immediately after this row.
- `entries[].idempotencyKey`: dedupe key for replay-safe writes.

### `POST /api/wallet/topups/checkout`

- Request:
  - `amount`: USD topup amount.
  - `currency`: currently only `usd`.
  - `provider`: currently only `stripe`.
- Response:
  - `topupId`: `topups.id`.
  - `checkoutUrl`: Stripe checkout URL.
  - `sessionId`: Stripe session id.
  - `status`: initial `pending`.

### `POST /api/wallet/crypto-topups`

- Request:
  - `amount` or `fiatAmount`: requested fiat credit amount.
  - `asset`: currently `USDT` or `USDC`.
  - `network`: currently `TRC20`, `ERC20`, or `POLYGON`.
  - `rail`: target field for separating ordinary wallet crypto topups from X402-labeled topups. Planned values are `wallet` and `x402`; until the DB field lands, callers should treat this as a product-level routing decision rather than a persisted contract.
- Response `topup`:
  - `address`: self-hosted deposit reference string or configured EVM receiver address.
  - `expectedAmount`: expected crypto amount. In testnet EVM mode this may include a tiny unique suffix so the auto-confirm worker can match transfers safely.
  - `fiatAmount`: credited fiat amount if completed successfully.
  - `status`: `pending`, `completed`, `short_paid`, `failed`, `expired`, or `cancelled`.

When `CHAIN_ENVIRONMENT=testnet` and EVM topup config is enabled, the server pins `asset` and `network` to the configured test chain instead of trusting arbitrary client input.

## Rental Payment Model

Target product model:

- New rentals should expose only `wallet` balance payment and `redeem_code`.
- `Stripe`, ordinary crypto wallet payment, and `X402` belong under wallet topup flows, not direct rental checkout.
- Historical `payments.method=stripe` and `payments.method=x402` must remain readable for old records.

See [payment-balance-model.md](/root/code/AnixOps-xray-install/docs/payment-balance-model.md) for the implementation plan.

## Compliance

### Compliance Profile Payload

- `id`: stable profile id such as `standard` or `restricted-egress`.
- `name`: display name.
- `mode`: `standard` or `restricted`.
- `version`: policy version written onto rentals.
- `description`: free-text description.
- `allowedPorts[]`: ports allowed by the restricted policy helper.
- `allowedCidrs[]`: CIDR allowlist written into policy payload.
- `blockedProtocols[]`: protocols rejected before provisioning.
- `isDefault`: whether this profile is default for quote/purchase fallback.
- `status`: currently `active` or `disabled`.

### Rental Compliance Fields

- `rentals.compliance_profile_id`: selected profile id for the rental.
- `rentals.compliance_policy_version`: version snapshot used when the rental was created.
- `rentals.compliance_enforced_at`: timestamp when compliance binding was stored.

## Referrals

### Invite Code

- `invite_codes.user_id`: inviter owner id.
- `invite_codes.code`: public code shared with invitees.
- `invite_codes.status`: `active` or `disabled`.

### Invite Binding

- `invite_bindings.inviter_id`: inviter user id.
- `invite_bindings.invitee_id`: invitee user id.
- `invite_bindings.invite_code_id`: source invite code row.

### Referral Reward

- `triggerType`: currently `wallet_topup`, `crypto_topup`, or `wallet_rental`.
- `status`: `credited` or `held`.
- `ledgerId`: linked `wallet_ledger.id` when credited.
- `idempotencyKey`: referral replay guard.

## Audit Anchor

### `POST /internal/audit/anchor`

- Request:
  - `limit`: maximum unanchored events included in the batch.
  - `chain`: optional target chain label.
  - `txHash`: optional chain transaction hash when known.
  - `receipt`: optional external receipt payload.
- Response `batch`:
  - `id`: `audit_anchor_batches.id`.
  - `fromEventId`: first event id in the batch.
  - `toEventId`: last event id in the batch.
  - `eventCount`: number of events in the batch.
  - `merkleRoot`: computed Merkle root.
  - `status`: `pending` or `anchored`.
  - `submissionStartedAt`: timestamp set once the worker enters the on-chain submission window; used to stop later runs from blindly sending a duplicate transaction.

### `GET /internal/audit/anchor/pending`

- Response `batch`:
  - Returns the oldest `pending` anchor batch when one exists.
  - `txHash`: when present with `chain`, the worker should recover by querying the receipt and finalizing instead of sending a new transaction.
  - `submissionStartedAt`: if present without `txHash`, a previous worker run already entered the submission window and later retries should prefer `--tx-hash` recovery over auto-send.

### `POST /internal/audit/anchor/:id/mark-submitting`

- Response `batch`:
  - Same anchor batch with `submissionStartedAt` populated.
  - This route is used immediately before attempting a real on-chain send, so later cron runs can distinguish:
    - `pending but never submitted`
    - `pending and may already have been submitted`

### `POST /internal/audit/anchor/:id/mark-submitted`

- Request:
  - `chain`: normalized chain label returned by the broadcaster.
  - `txHash`: chain transaction hash returned immediately after broadcast.
- Response `batch`:
  - Same anchor batch with `chain`, `txHash`, and `submissionStartedAt` populated while status remains `pending`.
  - This route is called before waiting for receipt, so a later worker run can recover by querying the stored `txHash` instead of broadcasting again.

### `POST /internal/audit/anchor/:id/finalize`

- Request:
  - `chain`: normalized chain label stored on the batch.
  - `txHash`: chain transaction hash to persist.
  - `receipt`: optional structured transaction receipt payload to archive with the batch.
- Response `batch`:
  - `status`: becomes `anchored`.
  - `chain`: persisted chain label.
  - `txHash`: persisted transaction hash.
  - `receipt`: archived receipt payload.
