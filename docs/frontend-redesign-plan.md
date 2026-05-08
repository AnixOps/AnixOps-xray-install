# AnixOps Frontend Redesign Plan

Last updated: 2026-05-09

## Scope

This document is the source of truth for the planned large frontend redesign, UI component library selection, and migration order.

When an AI Agent works on frontend redesign, UI components, console layout, admin layout, wallet UI, rental UI, or visual system changes, read this document before editing code.

The redesign is a controlled migration of the existing product UI. It is not a rewrite of backend APIs, wallet logic, rental logic, provider logic, or authentication.

## Current Rollout

The following surfaces have already been moved onto the new layout and component language:

- `web/components/ui/*` foundational primitives and Sonner-backed toast wrapper
- `web/components/layout/WorkspaceShell.tsx`
- `web/components/layout/WizardLayout.tsx`
- `web/components/layout/CenteredStatus.tsx`
- `web/components/console/WalletEntriesTable.tsx`
- `web/components/console/CryptoTopupsTable.tsx`
- `web/components/console/ConsoleNodesTable.tsx`
- `web/components/console/ConsoleAuditTable.tsx`
- `web/components/admin/ChainModeReadinessTable.tsx`
- `web/components/admin/CodeTemplatesTable.tsx`
- `web/components/admin/ComplianceProfilesTable.tsx`
- `web/components/admin/ComplianceRentalsTable.tsx`
- `web/components/admin/ComplianceStatsTable.tsx`
- `web/components/admin/ComplianceTrackingTables.tsx`
- `web/components/admin/RedeemCodesTable.tsx`
- `web/components/admin/RecentPaymentsTable.tsx`
- `web/components/admin/RecentFiatTopupsTable.tsx`
- `web/components/admin/RecentCryptoTopupsTable.tsx`
- `web/components/admin/RecentWalletLedgerTable.tsx`
- `web/components/admin/RecentAnchorBatchesTable.tsx`
- `web/components/admin/RecentRentalsTable.tsx`
- `web/components/admin/RecentFailedJobsTable.tsx`
- `web/components/admin/RecentQueueJobsTable.tsx`
- `web/components/admin/RecentStageLogsTable.tsx`
- `web/components/admin/ProvisioningRentalsTable.tsx`
- `web/components/admin/SystemHealthChecksTable.tsx`
- `web/components/admin/SearchUsersTable.tsx`
- `web/components/admin/SearchRentalsTable.tsx`
- `web/components/console/ConsoleHub.tsx`
- `web/app/admin/page.tsx`
- `web/app/payments/page.tsx`
- `web/components/rental/RentalWizard.tsx`
- `web/components/rental/RentalDashboard.tsx`
- `web/components/self-hosted/SelfHostedWizard.tsx`
- `web/app/rental/success/page.tsx`
- `web/app/rental/cancel/page.tsx`

The remaining work in this plan is mostly around console refinements and any remaining public-page polish that still uses the older visual language.

## Component Library Decision

主线定为：`shadcn/ui + Radix UI + TanStack Table + lucide-react + sonner`。

This is the preferred stack for the frontend redesign:

| Library | Role |
|---|---|
| `shadcn/ui` | Project-owned component source, built on Tailwind and suitable for a custom AnixOps design system |
| `Radix UI` | Accessible primitives for dialog, dropdown menu, select, tabs, popover, tooltip, and focus management |
| `TanStack Table` | Admin and console tables, including sorting, filtering, pagination, row selection, and column control |
| `lucide-react` | Consistent icon set for buttons, navigation, statuses, and compact controls |
| `sonner` | Toast and status feedback replacement for the current custom toast layer |

## Why This Stack

- The current frontend is `Next.js 15 + React 19 + Tailwind CSS 3`, with a thin local UI layer in `web/components/ui`.
- The product is mostly operational UI: wallet console, rental flow, self-hosted deployment flow, admin dashboard, billing, audit, and provider operations.
- The project needs a controlled design system, not a full visual reset into Ant Design, Material UI, or another strongly branded component suite.
- `shadcn/ui` keeps component code inside the repository, so components can be adapted to the existing AnixOps UI language and changed gradually.
- `Radix UI` and `TanStack Table` cover the hard interaction and data-grid behavior without forcing a visual style.

## Agent Workflow

1. Read `AGENT.md`.
2. If the task mentions frontend redesign, UI components, console layout, admin layout, wallet UI, rental UI, visual system, or component library migration, read this document next.
3. Confirm which phase the requested work belongs to.
4. Keep the patch inside that phase unless the user explicitly asks to expand scope.
5. Preserve existing API contracts and user-visible business behavior unless the task says otherwise.

## Dependency Plan

Install dependencies only when implementation starts. Do not add them during planning-only work.

Expected dependency set:

```bash
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast @radix-ui/react-tooltip @tanstack/react-table class-variance-authority clsx lucide-react sonner tailwind-merge
```

`shadcn/ui` components should be treated as project-owned source copied into `web/components/ui`, not as opaque vendor components.

## Phase Plan

| Phase | Focus | Main files | Exit criteria |
|---|---|---|---|
| 0 | Baseline and inventory | `web/components/ui`, `web/app/globals.css`, `tailwind.config.js`, large page files | Current components, repeated patterns, large files, and risky flows are mapped before implementation |
| 1 | UI foundation | `web/components/ui/*` | Existing imports still work; primitives have consistent variants, sizes, focus states, disabled states, and loading-friendly styling |
| 2 | Interaction primitives | `web/components/ui/*` | Dialog, Sheet or Drawer, DropdownMenu, Select, Tabs, Tooltip, Separator, Table, and toast are available from the local UI layer |
| 3 | App shell | `web/components/layout/*`, console and admin pages | Console/admin pages share sidebar, topbar, breadcrumbs, page header, filter bar, and action toolbar patterns |
| 4 | Admin table standardization | `web/app/admin/page.tsx`, extracted admin components | Payment, topup, ledger, redeem code, audit, and provider tables use TanStack Table patterns where complexity justifies it |
| 5 | Console and wallet redesign | `web/components/console/ConsoleHub.tsx` and extracted console components | Wallet, nodes, audit, referral, and chain mode views are readable, dense, and consistent |
| 6 | Rental and self-hosted flows | `web/components/rental/*`, `web/components/self-hosted/*` | Step flows use the same form, status, summary, and action components |
| 7 | Visual token refinement | `web/app/globals.css`, `tailwind.config.js` | Tokens, radius, shadows, surfaces, and state colors are consistent across public, console, admin, rental, and self-hosted surfaces |

## Detailed Migration Order

1. Start with Phase 0 inventory and write a short checklist before touching UI behavior.
2. Build or replace `web/components/ui` primitives while preserving the existing public exports.
3. Replace the current custom toast with `sonner` through a compatibility wrapper so existing `useToast` call sites can migrate gradually.
4. Add Radix-backed components only when a page needs them; do not add unused wrappers in bulk.
5. Extract page sections before restyling large pages.
6. Migrate tables with high operational value first: redeem codes, wallet ledger, crypto topups, fiat topups, payments, audit anchors.
7. Add shared layout components after at least one admin and one console page have matching needs.
8. Refine global tokens after component behavior and layout structure are stable.

## Design Direction

- Prefer dense, calm, operational UI over marketing-page composition.
- Keep information scanning easy: clear hierarchy, compact metrics, stable tables, predictable action placement.
- Avoid large decorative cards inside cards, excessive glass effects, and oversized rounded panels in admin workflows.
- Use icons for compact controls where the action is conventional.
- Keep the public homepage, wallet console, admin dashboard, rental flow, and self-hosted flow visually related but not identical.

## Page Priorities

| Priority | Surface | Reason |
|---|---|---|
| P0 | `web/components/ui` | All other work depends on stable primitives |
| P1 | `web/app/admin/page.tsx` | Largest file, most table-heavy workflow, highest maintenance risk |
| P1 | `web/components/console/ConsoleHub.tsx` | User wallet and operational console entry point |
| P2 | `web/components/rental/RentalWizard.tsx` | Revenue-critical flow, should migrate after primitives are stable |
| P2 | `web/components/rental/RentalDashboard.tsx` | Existing customer workflow, config copy and lifecycle actions must stay reliable |
| P2 | `web/components/self-hosted/SelfHostedWizard.tsx` | Complex step flow, benefits from shared form and status components |
| P3 | `web/app/page.tsx` | Public landing surface, should follow the new system after product UI is stable |

## Acceptance Criteria

Every implementation phase should meet these checks before commit:

- `npm run lint` passes.
- `npm test` passes unless the change is docs-only.
- `npm run build` passes for frontend behavior changes.
- Keyboard navigation works for Radix-backed menus, dialogs, selects, tabs, and tooltips.
- Mobile layouts do not overflow at common widths around `360px`, `390px`, and `430px`.
- Existing wallet, rental, payment, redeem code, and admin actions keep their current API payloads unless intentionally changed.
- Visual changes do not hide error, pending, expired, short-paid, completed, or disabled states.

## Risk Controls

| Risk | Control |
|---|---|
| Big-bang UI rewrite breaks money flows | Migrate page by page and keep business API contracts stable |
| Component library styles fight current Tailwind tokens | Keep shadcn/Radix source local and adapt tokens in small patches |
| Admin table migration loses bulk actions | Migrate one table at a time and preserve row selection behavior |
| Toast migration breaks existing call sites | Keep a compatibility wrapper around the current `useToast` API until all callers are migrated |
| Large file extraction changes behavior accidentally | Extract render-only sections first, then move state after tests or manual checks exist |
| Visual polish delays operational fixes | Prioritize console/admin readability and workflow reliability over decorative redesign |

## Rollback Strategy

- Keep each phase in small commits.
- Preserve `@/components/ui` exports so call sites can be rolled back independently.
- When migrating a large page, extract components in one commit and restyle in a later commit.
- Avoid deleting old helpers until the replacement has at least one production page using it.
- For high-risk pages, keep screenshots or manual check notes in the PR/commit summary.

## Implementation Guardrails

- Do not change authentication, wallet ledger, topup confirmation, rental provisioning, or payment semantics during UI-only work.
- Do not introduce a second global styling system.
- Do not place generated shadcn components outside the local `web/components/ui` ownership boundary unless there is a clear shared-layout reason.
- Prefer typed component props and explicit status enums for operational UI.
- Prefer extracting readable page sections over creating generic abstractions too early.
- Preserve Chinese/English copy behavior and the existing i18n store where pages already use it.

## Non-Goals

- Do not migrate the whole product to Ant Design, Material UI, Mantine, or HeroUI unless the product direction changes explicitly.
- Do not rewrite backend API contracts as part of visual migration unless the frontend task requires it.
- Do not redesign every page in one change. Migrate page by page and keep each patch reviewable.
