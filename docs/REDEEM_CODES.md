# AnixOps Redeem Code System

## Overview

The redeem code system allows you to issue prepaid tokens to users that can be exchanged for node rental time without going through Stripe payment.

## Features

- **Prepaid tokens**: Generate codes like `ANIX-ABCD-EFGH` that grant specific rental durations
- **Flexible durations**: Support custom durations (1, 6, 8, 12, 16, 24, 48, 72 hours)
- **Expiry dates**: Optional expiration date for time-limited promotions
- **One-time use**: Each code can only be redeemed once
- **Audit trail**: All redemptions logged with user association

## Usage

### 1. Generate Redeem Codes

Use the Node.js script to generate codes:

```bash
# Set your API credentials
export WORKER_URL="https://anixops.your-subdomain.workers.dev"
export API_SECRET="your-api-secret-from-wrangler-secrets"

# Generate 10 codes for 8 hours each
node scripts/generate-redeem-codes.js 10 8

# Generate codes with expiration date
node scripts/generate-redeem-codes.js 10 8 2026-12-31T23:59:59Z
```

For self-hosted deployments, point the same script at your API server:

```bash
export WORKER_URL="http://localhost:8787"
export API_SECRET="your-api-secret-from-env"
node scripts/generate-redeem-codes.js 10 8
```

Valid durations: 1, 6, 8, 12, 16, 24, 48, 72 hours

### 2. Distribute Codes

Copy the generated codes and distribute to users via:
- Email campaigns
- Promotional events
- Gift cards
- Partner giveaways

### 3. User Redemption

Users can redeem codes in the rental wizard:
1. Select protocol (VLESS+Reality or Hysteria2)
2. Enter email address
3. Choose "兑换码" / "Redeem Code" as payment method
4. Enter the code (format: `ANIX-XXXX-XXXX`)
5. Click "验证" / "Validate" to verify
6. Complete the deployment

## API Endpoints

### Validate Code (Public)
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
  "durationHours": 8
}
```

### Redeem Code (Authenticated)
```http
POST /api/redeem
Authorization: Bearer <token>
Content-Type: application/json

{
  "code": "ANIX-ABCD-EFGH",
  "protocol": "vless-reality"
}
```

### Admin: Generate Codes
```http
POST /api/admin/redeem-codes
X-API-Secret: <secret>
Content-Type: application/json

{
  "count": 10,
  "durationHours": 8,
  "expiresAt": "2026-12-31T23:59:59Z"  // optional
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
    duration_hours INTEGER NOT NULL,
    used_by TEXT REFERENCES users(id),
    used_at DATETIME,
    expires_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX idx_redeem_codes_code ON redeem_codes(code);
CREATE INDEX idx_redeem_codes_used ON redeem_codes(used_by);
```

## Security Considerations

1. **API Secret Protection**: Keep `API_SECRET` secure - it grants admin access
2. **Code Format**: Codes use base32-like alphabet (excludes ambiguous characters like 0, O, 1, I)
3. **One-time Use**: Codes cannot be reused once redeemed
4. **Atomic Claim**: Redemption updates the code with a `used_by IS NULL` guard to prevent concurrent double use
5. **Validation**: Codes are validated before redemption to prevent failed transactions
6. **Expiration**: Optional expiration dates prevent old codes from being used

## Integration with Existing Payment Methods

The redeem code system integrates with existing payment flows:

- **Stripe**: Credit card payment (revenue)
- **Free Trial**: One-time free rental per email (acquisition)
- **Redeem Code**: Prepaid tokens (flexible distribution)

All methods create identical rental records in the database, with `payment_method` set to `"redeem_code"` for redeemed codes.
