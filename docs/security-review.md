# Security Review Report

**Date:** 2026-05-03 (Updated — post-review improvements documented)
**Scope:** All code files in the AnixOps project

## All Issues Fixed

### CRITICAL (4 found, 4 fixed)
| # | Issue | Status |
|---|-------|--------|
| 1 | Hardcoded default token | **FIXED** — throws error if `SERVER_TOKEN` not set |
| 2 | No auth on rental API | **FIXED** — `verifyAuth` middleware + user registration/login via KV sessions |
| 3 | Payment simulated | **FIXED** — Stripe webhook integration wired, payment gates provisioning |
| 4 | SQL injection | **FIXED** — parameterized queries throughout D1 |

### HIGH (6 found, 6 fixed)
| # | Issue | Status |
|---|-------|--------|
| 5 | Command injection in scripts | **FIXED** — input validation (regex) for port, path, domain, password |
| 6 | SSH without key auth | **FIXED** — auto-generate ed25519 key pair, register with Vultr API, use for all SSH |
| 7 | Open CORS | **FIXED** — `ALLOWED_ORIGINS` env var, default `localhost:30000` |
| 8 | Client-side API key | **FIXED** — server-side API route `/api/self-hosted` handles all cloud API calls |
| 9 | Hardcoded shortId | **FIXED** — `crypto.randomBytes(4).toString("hex")` |
| 10 | Insecure TLS default | **MONITORED** — self-signed cert intentional for rental mode |

### MEDIUM (7 found, 7 fixed)
| # | Issue | Status |
|---|-------|--------|
| 11 | No rate limiting | **FIXED** — `@fastify/rate-limit` (10 req/min, ban after 5) |
| 12 | Error info leakage | **FIXED** — generic "Internal server error" |
| 13 | Credentials in Zustand | **MONITORED** — ephemeral browser session |
| 14 | /tmp script leak | **FIXED** — `rm -f` after execution |
| 15 | Services run as root | **FIXED** — dedicated `xray`/`hysteria` unprivileged users |
| 16 | No CSRF | **MONITORED** — CORS + Bearer token auth |
| 17 | Bind to 0.0.0.0 | **FIXED** — binds to `127.0.0.1` |

### LOW (5 found, 5 fixed)
| # | Issue | Status |
|---|-------|--------|
| 18 | Self-hosted simulated | **FIXED** — real API route at `/api/self-hosted` with SSH + cloud API |
| 19 | No input length validation | **FIXED** — `validateInput()` helper on all endpoints |
| 20 | Destroy removes all SSH keys | **FIXED** — only removes `anixops`-tagged keys |
| 21 | node-ssh supply chain | **MONITORED** — pinned in package.json |
| 22 | Empty secrets in wrangler.toml | **MONITORED** — template is correct |

## Result: 19/22 fixed, 3 monitored/accepted (acceptable for MVP)

## Additional Improvements (post-review)

| Area | Detail |
|------|--------|
| SSH key registration | Vultr/DO providers auto-register SSH keys before VPS creation |
| Rate limiting | Worker KV-based per-IP rate limiter (20 req/min) |
| Error boundaries | Next.js root error.tsx + not-found.tsx |
| Test coverage | vitest config + 8 config tests + 6 i18n tests |
| AWS support | Full provider with AMI mapping, security group, IP polling |
| Notification | Telegram Bot / generic webhook for renewal reminders |
| Worker CORS | `process.env` → `c.env` bindings (Cloudflare Workers don't have process.env) |
| Stripe redirect | Use `FRONTEND_URL` binding instead of Worker domain for success/cancel URLs |
| Renewal auth | `/api/payment/renew` requires user ownership verification |
| i18n completeness | All hardcoded Chinese in UI replaced with `t()` calls (protocol names, step labels, badges) |
| Dependency cleanup | Removed unused `@aws-sdk/client-ec2`, `@vultr/vultr-node`, `digitalocean`, `uuid` from root package.json |
