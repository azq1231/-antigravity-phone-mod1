
# 🧪 Testing Guide for Antigravity

This project doesn't have a standalone E2E framework configured yet. However, we've provided basic integration tests and a setup for Playwright if you wish to run full browser automation.

## 1. Quick Integration Test (No Install Needed)

Run our custom integration script which:

1. Starts `server.js` automatically.
2. Pings key endpoints (`/`, `/api`, `/css/style.css`).
3. Verifies 200 OK responses.

```bash
node tests/integration_test.js
```

## 2. Full E2E with Playwright (Browser Automation)

If you want to simulate real user interactions (clicking buttons, sending messages):

1. **Install Playwright**:

   ```bash
   npm init playwright@latest
   # Or manually:
   # npm install -D @playwright/test
   # npx playwright install
   ```

2. **Run Tests**:

   ```bash
   npx playwright test tests/e2e/spec.js
   ```

## 3. Sanity Check (Static Analysis)

Checks for missing files, broken imports, and syntax errors.

```bash
node scripts/sanity_check.js
```
