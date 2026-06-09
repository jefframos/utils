# Testing and Runtime Observation

## No-Build Observation Loop

Use the development observation command to run the game and unit tests continuously:

```bash
npm run dev:observe
```

This runs:
- Vite dev server on http://127.0.0.1:4173
- Vitest watch mode for fast feedback

## Automated Test Commands

- `npm run test` : run all unit/invariant tests once
- `npm run test:watch` : watch unit tests during development
- `npm run test:coverage` : generate coverage report
- `npm run typecheck` : TypeScript checking only
- `npm run check` : typecheck + unit tests

## Runtime Smoke Tests (No Build)

Install browser once:

```bash
npm run test:runtime:install
```

Then run runtime checks:

```bash
npm run test:runtime
```

Runtime smoke tests launch the Vite dev server (no production build), open the game in Chromium, and fail if browser console errors or page errors are detected.

## Inventory Breakage Protection

Inventory invariants live in:
- `tests/inventory.invariants.test.ts`

These tests repeatedly try random add/move operations and enforce:
- no overlapping occupied cells
- in-bounds placement for every shaped item
- positive quantities
- stack limits respected

If someone introduces a regression in inventory placement/stacking logic, these tests should fail quickly.
