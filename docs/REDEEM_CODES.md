# AnixOps Redeem Code System

Last updated: 2026-05-07

## Overview

Redeem codes now support two modes:

- `duration`: a one-time code that creates a prepaid rental without Stripe.
- `wallet`: a one-time code that credits wallet balance through `wallet_ledger`.

Both modes keep one-time claim semantics with a `used_by IS NULL` guard.

In the formal release UI, these appear as:

- `wallet`: `CDK 余额直充型`
- `duration`: `CDK 单次型`

## Features

- **Rental tokens**: Generate codes like `ANIX-ABCD-EFGH` that grant specific rental durations.
- **Wallet credits**: Generate balance codes by setting `codeType: "wallet"` and `walletAmount`.
- **Flexible durations**: Duration codes support 1, 6, 8, 12, 16, 24, 48, 72 hours.
- **Expiry dates**: Optional expiration date for time-limited promotions.
- **One-time use**: Each code can only be redeemed once.
- **Ledger auditability**: Wallet codes write append-only `wallet_ledger` entries.
- **Legacy compatibility**: Duration codes still create rentals directly via `/api/redeem`.

## User Flows

### Duration Code Rental

Users redeem duration codes in the rental wizard:

1. Select protocol.
2. Enter email address.
3. Choose `Redeem Code`.
4. Validate the code.
5. Complete deployment.

Endpoint: `POST /api/redeem`

### Wallet Code Credit

Users redeem wallet codes from wallet flows or API clients:

Endpoint: `POST /api/wallet/redeem`

The response includes `balanceDelta`, `codeType`, `ledgerEntryId`, and the updated source.

## API Endpoints

### Validate Code

```http
POST /api/redeem/validate
Content-Type: application/json

{
  "code": "ANIX-ABCD-EFGH"
}
```

Response:

```json
{
  "valid": true,
  "codeType": "duration",
  "durationHours": 8,
  "walletAmount": null
}
```

### Redeem Duration Code

```http
POST /api/redeem
Authorization: Bearer <token>
Content-Type: application/json

{
  "code": "ANIX-ABCD-EFGH",
  "protocol": "vless-reality",
  "complianceProfileId": "standard"
}
```

Wallet codes are rejected by this endpoint and should use `/api/wallet/redeem`.

### Redeem Wallet Code

```http
POST /api/wallet/redeem
Authorization: Bearer <token>
Content-Type: application/json

{
  "code": "ANIX-WALLET-01"
}
```

### Admin: Generate Duration Codes

```http
POST /api/admin/redeem-codes
X-API-Secret: <secret>
Content-Type: application/json

{
  "count": 10,
  "codeType": "duration",
  "durationHours": 8,
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

### Admin: Generate Wallet Codes

```http
POST /api/admin/redeem-codes
X-API-Secret: <secret>
Content-Type: application/json

{
  "count": 10,
  "codeType": "wallet",
  "walletAmount": 25,
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

### Admin: List Codes

```http
GET /api/admin/redeem-codes
X-API-Secret: <secret>
```

## Database Schema

```sql
CREATE TABLE redeem_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    code_type TEXT NOT NULL DEFAULT 'duration',
    duration_hours INTEGER NOT NULL,
    wallet_amount REAL,
    used_by TEXT REFERENCES users(id),
    used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

Runtime startup also applies `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for `code_type` and `wallet_amount` on existing self-hosted databases.

## Security Considerations

1. Keep `API_SECRET` secure; it grants admin access.
2. Codes use a base32-like alphabet for generated values.
3. One-time claims use an atomic `used_by IS NULL` update guard.
4. Optional expiration prevents old codes from being used.
5. Wallet credits go through `wallet_ledger` with idempotency keys.
6. Duration redemption checks account freeze state and compliance profile before provisioning.
