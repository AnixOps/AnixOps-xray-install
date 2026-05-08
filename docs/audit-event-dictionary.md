# AnixOps Audit Event Dictionary

Last updated: 2026-05-07

## Purpose

This file lists the structured event types currently written into `audit_events`.

Each event is stored with:

- `id`
- `traceId`
- `actorType`
- `actorUserId`
- `rentalId`
- `eventType`
- `eventVersion`
- `payload`
- `previousHash`
- `eventHash`
- `anchorBatchId`
- `createdAt`

## Current Event Types

### `http_mutation`

- Trigger: any non-webhook `POST`, `PUT`, `PATCH`, or `DELETE` request after the response is sent.
- Payload:
  - `method`
  - `path`
  - `status`

### `wallet_topup_completed`

- Trigger: Stripe wallet topup completion.
- Payload:
  - `topupId`
  - `amount`
  - `currency`
  - `stripeSessionId`

### `wallet_redeem_credited`

- Trigger: successful wallet-code redemption.
- Payload:
  - `codeId`
  - `codeType`
  - `amount`
  - `ledgerEntryId`
  - `alreadyProcessed`

### `crypto_topup_created`

- Trigger: user creates a crypto topup order.
- Payload:
  - `topupId`
  - `asset`
  - `network`
  - `fiatAmount`
  - `currency`

### `crypto_topup_completed`

- Trigger: internal crypto confirmation completes and credits the wallet.
- Payload:
  - `topupId`
  - `asset`
  - `network`
  - `fiatAmount`
  - `txHash`
  - `alreadyProcessed`

### `rental_created`

- Trigger: rental created by wallet payment, Stripe webhook completion, or redeem-code rental path.
- Payload:
  - `protocol`
  - `durationHours`
  - `paymentMethod`
  - `complianceProfileId`
  - `compliancePolicyVersion`

### `compliance_profile_saved`

- Trigger: admin creates or updates a compliance profile.
- Payload:
  - `profileId`
  - `version`
  - `mode`

### `admin_user_freeze_updated`

- Trigger: admin freezes or unfreezes a user.
- Payload:
  - `userId`
  - `frozen`
  - `releasedReferralRewards`
  - `actor`

### `referral_invite_bound`

- Trigger: invitee binds an inviter code.
- Payload:
  - `inviteCodeId`
  - `inviterId`
  - `alreadyBound`

### `audit_anchor_batch_created`

- Trigger: internal anchor batch creation.
- Payload:
  - `batchId`
  - `eventCount`
  - `merkleRoot`
  - `status`

## Hash Chain Rules

- `previousHash` is `GENESIS` for the first event.
- Each next event hashes the canonical payload plus the previous event hash.
- `eventHash` is recalculated by the verifier in [verify-audit-anchor.js](/root/code/AnixOps-xray-install/scripts/verify-audit-anchor.js).

## Notes

- `audit_log` remains in place as a compatibility layer for older UI views and migration periods.
- Business events are intentionally narrow; wide request metadata goes into `http_mutation`.
- New event types should be added here when introduced in `server/src/index.ts`.
