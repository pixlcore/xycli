# CLI Integration Tests

These tests exercise the CLI against a running xyOps development server. They use Node.js's built-in test runner and the project's existing dependencies.

## Setup

Use Node.js 22 or newer and install the CLI dependencies with `npm install`.

Start xyOps at `http://localhost:5522` and configure an administrator API key using your normal CLI config file or the `XYOPS_API_KEY` environment variable. The tests read the same configuration as `xy`, including `XYOPS_BASE_URL` overrides. They refuse to run against a different server address.

Use an xyOps version that supports restoring API key IDs, hashes, and masks through `create_api_key`. The monitor tests also need a connected server and a server group. The log tests expect the standard log columns and debug entries in the current xyOps log.

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

## Coverage

| Suite | Coverage |
| --- | --- |
| `categories` | CRUD, actions and limits, JSON input, validation, pagination, help |
| `channels` | CRUD, recipients, indexed edits, filters, validation, help |
| `log` | Log searches, latest rows, matching, column selection, native output |
| `monitors` | CRUD, groups, evaluator requests, type conversions, validation, help |
| `pagination` | Pagination arguments, search requests, command variants, resource limits |
| `plugins` | CRUD for all four Plugin types, parameters, groups, validation, help |
| `transfer` | All portable object types, preview and confirmation, dependencies, gzip, validation, partial failures |
| `transfer-apikey` | Export, deletion, import, and authentication with the original plaintext secret |
| `transfer-workflow` | Fresh workflow migration with shared dependencies |

Pagination checks that require saved events, completed jobs, or alert history report a skip when those records are unavailable.

## Fixtures and Cleanup

The mutating suites create uniquely named disposable objects and remove them in cleanup blocks, including after assertion failures. Test events have no active triggers, channels are never invoked, monitor sources use constants, and Plugin definitions are never executed or attached to other objects. Temporary files live in private operating-system temp directories and are removed by native test hooks.

API key tests keep plaintext secrets in memory. Export files contain the stored hash and mask, and are deleted after the test. Captured CLI output is omitted from process failure messages because it can contain credentials.

A forced process termination or an unavailable server can prevent server cleanup. If a run is interrupted, check for its uniquely named `cli_*` fixtures before rerunning. The tests never remove unrelated objects.

## Adding a Suite

Add a CommonJS file named `test/NAME.test.js`. The controller will discover it automatically. Use `node:test` and `node:assert/strict`, and reuse `test/helpers/common.js` for configuration, CLI calls, temporary directories, and sequential lifecycle checks.

Call `loadTestConfig()` before any server request. Register temporary directory cleanup immediately, and put mutations inside a `try` block with fixture cleanup in `finally`. Await each lifecycle check so dependent operations run in order.

Keep helper modules under `test/helpers/`. The pagination preload records only method names and pagination fields at the SDK boundary; it does not record authentication or response data.
