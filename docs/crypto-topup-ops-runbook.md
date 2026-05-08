# Crypto Topup Ops Runbook

Last updated: 2026-05-08

## Scope

This runbook covers the current self-hosted `crypto_topups` MVP flow:

- order created by `POST /api/wallet/crypto-topups`
- order confirmed by `POST /internal/crypto-topups/:id/confirm`
- wallet credit written through `wallet_ledger`

It assumes the current system may use either:

- manual confirmation through `scripts/crypto-topup-confirm.js`
- the cron-friendly EVM scan worker `scripts/crypto-topup-worker.js`

It is still not a full production listener with external custody, exchange-rate sync, and reconciliation dashboards.

## Status Model

- `pending`: order created, waiting for funds or confirmation.
- `completed`: credited successfully into `wallet_ledger`.
- `short_paid`: received amount below expected amount.
- `failed`: terminal failure.
- `expired`: order timed out without valid confirmation.
- `cancelled`: order intentionally cancelled by operations.

## Standard Checks

For any incident, confirm:

1. `crypto_topups.id`
2. `user_id`
3. `asset`
4. `network`
5. `expected_amount`
6. `received_amount`
7. `fiat_amount`
8. `status`
9. `tx_hash`
10. `ledger_id`
11. `idempotency_key`

For EVM testnet mode also confirm:

12. `expected_amount` was paid exactly as returned by the API
13. the worker matched on the configured receiver address and token contract

## Auto Confirmation Worker

Purpose:

- scan recent ERC20 `Transfer` logs for the configured token and receiver address
- match them against pending topups
- auto-confirm only when one transfer maps to one pending topup

Recommended operation:

1. Run `node scripts/crypto-topup-worker.js --json` every minute on the self-hosted server.
2. Watch `matched`, `confirmed`, and `ambiguous` in the JSON output.
3. Treat `ambiguous > 0` as an operator queue, not as an auto-credit signal.

Matching behavior:

- the worker requires the exact `expectedAmount`
- the worker requires enough confirmations
- the worker skips expired topups
- the worker fails closed when one transfer could match multiple pending topups

## Short Pay

Symptoms:

- `status=short_paid`
- `received_amount < expected_amount`

Operator action:

1. Verify the chain transaction and actual received amount.
2. Do not manually flip the row to `completed`.
3. Either refund off-platform or request the user to top up the missing amount with a new order.
4. Keep the original `short_paid` row for auditability.

Reason:

- The current credit path is intentionally fail-closed on underpayment.

## Duplicate Payment / Duplicate Confirmation

Symptoms:

- Same `tx_hash` observed more than once.
- Repeated confirmation request for the same topup.

Operator action:

1. Check whether `ledger_id` is already present.
2. If `status=completed`, treat later confirmations as no-op.
3. Do not create a second ledger row.

Reason:

- The system deduplicates by `idempotency_key` and network/tx hash.

## Ambiguous Auto-Match

Symptoms:

- worker reports `ambiguous > 0`
- no automatic credit is written even though a valid transfer exists

Operator action:

1. Inspect the pending rows that share the same receiver address and amount.
2. Use the returned `expectedAmount` and creation time to identify the intended order.
3. Confirm the intended row manually with `scripts/crypto-topup-confirm.js`.
4. Avoid bulk-forcing all matching rows to `completed`.

Reason:

- the worker is designed to fail closed rather than guess.

## Timeout / Expired Order

Symptoms:

- Order remains `pending` past `expires_at`.

Operator action:

1. Mark as `expired` if the payment window is no longer valid.
2. If funds arrive after expiry, create a new reviewed order or handle manually; do not silently credit the expired row.

## Wrong Network / Wrong Asset

Symptoms:

- User sends a transaction on a chain or asset that does not match the order.

Operator action:

1. Do not confirm the order into wallet balance.
2. Keep the row in `pending`, `failed`, or `cancelled` depending on internal policy.
3. Handle asset recovery outside the automated credit path if recovery is even possible.

## Manual Confirmation Checklist

Before calling the internal confirm endpoint:

1. Confirm the order is still the intended target.
2. Verify asset and network match.
3. Verify the transaction hash is final enough for your policy.
4. Verify the received amount is not below expected amount.
5. Confirm the topup has not already been credited.

## Future Automation Notes

When a real production chain listener is added, it should preserve these operational rules:

- underpayment stays fail-closed
- duplicated confirmations remain idempotent
- expired orders are not silently resurrected
- asset/network mismatch never auto-credits
