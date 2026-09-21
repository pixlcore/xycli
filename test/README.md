# CLI Integration Tests

These tests exercise the CLI against a running xyOps development server. They use Node.js's built-in test runner and the project's existing dependencies.

## Setup

Use Node.js 22 or newer and install the CLI dependencies with `npm install`.

Start xyOps at `http://localhost:5522` and configure an administrator API key using your normal CLI config file or the `XYOPS_API_KEY` environment variable. The tests read the same configuration as `xy`, including `XYOPS_BASE_URL` overrides. They refuse to run against a different server address.

Use an xyOps version that supports restoring API key IDs, hashes, and masks through `create_api_key`. The Server and Job tests need a connected server, the Job tests need the enabled stock Shell Plugin, and the Monitor tests also need a server group. The log tests expect the standard log columns and debug entries in the current xyOps log.

## Running Tests

Run every suite, one at a time:

```sh
npm test
```

The equivalent controller command is:

```sh
node test.js
```

Run selected suites, or list the available names:

```sh
node test.js categories channels
npm test -- transfer-apikey
node test.js --list
```

The controller discovers `test/*.test.js`, uses a separate process for each suite, and sets native test concurrency to one. Do not run multiple controllers against the same server at once. Some checks compare the definitions before and after a test, so avoid editing server objects while the suite runs.

You can also run one file directly and choose a native reporter:

```sh
node --test --test-reporter=spec test/monitors.test.js
```

The controller exits with a nonzero status if any suite fails. A failed lifecycle check stops the remaining dependent steps in that suite, runs cleanup, and allows the next suite to proceed.

The configuration and sync unit suites run offline with disposable directories and do not contact xyOps. Run them directly without configuring a development server:

```sh
node --test test/config.test.js test/sync-unit.test.js
```

## Coverage

| Suite | Coverage |
| --- | --- |
| `categories` | CRUD, actions and limits, JSON input, validation, pagination, help |
| `channels` | CRUD, recipients, indexed edits, filters, validation, help |
| `config` | Offline user-file updates, inherited-setting isolation, missing-file creation, dotted edits, permissions, and read-only display |
| `events` | CRUD, dependency filters, nested edits, triggers, actions, limits, fields, validation, and help |
| `jobs` | Event launch, parameter and input overrides, completed reports, output logs, search, rerun, deletion, validation, and help |
| `log` | Log searches, latest rows, matching, column selection, native output |
| `markdown` | Terminal rendering, inline formatting inside list items, typographic bullets, and output margins |
| `monitors` | CRUD, groups, evaluator requests, type conversions, validation, help |
| `marketplace` | Search, details, README rendering, install preview, confirmed install and upgrade, validation, help |
| `pagination` | Pagination arguments, search requests, command variants, resource limits |
| `plugins` | CRUD for all four Plugin types, parameters, groups, validation, help |
| `secrets` | Vault metadata, assignments, redacted previews, full field replacement, confirmed decryption, deletion, validation, help |
| `servers` | Active and recently offline lists, local filters, installer generation, historical search, live and historical Server details, charts, processes, connections, pagination, validation, help |
| `system` | Admin dashboard, conductors, connected users, export, maintenance, optimization, rate resets, diagnostics, broadcasts, help |
| `sync` | Setup export, isolated filesystem discovery, external property files, dry-run, upsync, downsync, composite global-state governance, no-op detection, and guarded delete mode |
| `sync-unit` | Offline setup extension fallbacks, new-only exports and setup completion commands, PID locking and stale recovery, up-only deletion guards, pre-delete failure blocking, stock/Marketplace deletion protection, inherited settings and CLI overrides, warning/error exit status, duplicates, quiet/dry runs, completion failures, and notification delivery after warnings or errors |
| `tags` | CRUD, metadata search, sparse future-proof updates, JSON input, validation, pagination, help |
| `tickets` | Search, CRUD, number resolution, comments, attachment uploads/downloads, Events, related Job lookup, sparse updates, validation, help |
| `toast` | Warning-box word wrapping and terminal-width limits |
| `transfer` | All portable object types, preview and confirmation, dependencies, gzip, validation, partial failures |
| `transfer-apikey` | Export, deletion, import, and authentication with the original plaintext secret |
| `transfer-workflow` | Fresh workflow migration with shared dependencies |
| `webhook` | CRUD, aliases, headers, exact body input, live Markdown test reports, sparse updates, validation, help |

Pagination checks that require saved events, completed jobs, or alert history report a skip when those records are unavailable.

## Fixtures and Cleanup

The mutating suites create uniquely named disposable objects and remove them in cleanup blocks, including after assertion failures. Test events have no active triggers, channels are never invoked, monitor sources use constants, and Plugin definitions are never executed or attached to other objects. Temporary files live in private operating-system temp directories and are removed by native test hooks.

The Job suite creates one enabled Event with no triggers, launches short-lived Shell Plugin Jobs only through explicit test commands, and deletes the completed Jobs and Event. The Marketplace suite installs and upgrades `pixlcore/xyplug-ai`, then deletes it without executing or attaching it to an Event. The suite requires this product to be uninstalled when the test begins and removes its own installation during cleanup. Ticket fixtures remain in `draft` for their entire lifecycle so assigned test users never receive email notifications.

API key tests keep plaintext secrets in memory. Export files contain the stored hash and mask, and are deleted after the test. Captured CLI output is omitted from process failure messages because it can contain credentials.

Secret Vault tests use uniquely generated disposable values. They verify sensitive values by digest wherever practical, ensure dry-run and verbose diagnostics are redacted, and delete the vault during cleanup. Confirmed decrypt checks intentionally exercise the audited API operation.

A forced process termination or an unavailable server can prevent server cleanup. If a run is interrupted, check for its uniquely named `cli_*` fixtures before rerunning. The tests never remove unrelated objects.

## Adding a Suite

Add a CommonJS file named `test/NAME.test.js`. The controller will discover it automatically. Use `node:test` and `node:assert/strict`, and reuse `test/helpers/common.js` for configuration, CLI calls, temporary directories, and sequential lifecycle checks.

Call `loadTestConfig()` before any server request. Register temporary directory cleanup immediately, and put mutations inside a `try` block with fixture cleanup in `finally`. Await each lifecycle check so dependent operations run in order.

Keep helper modules under `test/helpers/`. The pagination preload records only method names and pagination fields at the SDK boundary; it does not record authentication or response data.
