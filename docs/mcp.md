# MCP Server

xyCLI connects AI applications to xyOps through the Model Context Protocol (MCP). Both transports use your normal CLI connection settings. STDIO uses your configured API key; HTTP uses the key supplied by each client. xyOps enforces that key's privileges and resource restrictions on every API operation.

## Quick start

First, if you haven't already done so, follow [Getting started](../README.md#getting-started) to install Node.js and xyCLI, then configure your xyOps connection and API key. Alternatively, use the [Docker image](#running-with-docker), which includes Node.js and xyCLI.

For an application that launches a local MCP process, configure its executable as `xy` and its arguments as `mcp`, `stdio`:

```sh
xy mcp stdio
```

The STDIO server uses your existing xyCLI authentication: the `XYOPS_API_KEY` environment variable or the `api_key` setting in your `cli.json` configuration file. The environment variable takes precedence.

The application launches this command and communicates through its standard streams. stdout contains only MCP messages; diagnostics go to stderr. If the application cannot find `xy`, use the absolute path reported by `which xy` on macOS/Linux or `where xy` on Windows.

For a client that connects over HTTP, start a foreground server like so:

```sh
xy mcp serve --port 8080
```

Connect the client to `http://127.0.0.1:8080/mcp` and configure its `Authorization` header as `Bearer YOUR_XYOPS_API_KEY`. The `mcp` prefix is required, and the port is a named option. Stop the server with Ctrl-C.

MCP requires Node.js 20 or newer. This server supports the [2026-07-28 protocol](https://blog.modelcontextprotocol.io/posts/2026-07-28/) and compatible 2025-era clients over STDIO and stateless Streamable HTTP. Legacy HTTP+SSE endpoints and persistent HTTP sessions are not provided.

## Running with Docker

The general-purpose `ghcr.io/pixlcore/xycli` image starts the MCP HTTP server by default. With Docker installed, this single command supplies all required server settings:

```sh
docker run --rm --init --name xycli-mcp \
	-p 127.0.0.1:8080:8080 \
	-e XYOPS_BASE_URL="https://xyops.example.com" \
	-e XYOPS_MCP='{"allowed_hosts":["localhost","127.0.0.1","[::1]"]}' \
	ghcr.io/pixlcore/xycli:latest
```

Replace `XYOPS_BASE_URL` with your xyOps URL. Connect your MCP client to `http://127.0.0.1:8080/mcp` and configure its `Authorization` header as `Bearer YOUR_XYOPS_API_KEY`. HTTP mode does not need `XYOPS_API_KEY` in the container; each client supplies its own key.

The server listens on `0.0.0.0:8080` inside the container, while the example publishes it only on your host's loopback interface. For network access, configure `allowed_hosts` for the hostname your clients use, publish the appropriate interface, and provide HTTPS through a reverse proxy or the server's TLS options. `allowed_hosts` contains hostnames without port numbers, not the container's bind address.

If xyOps runs on your Docker host, use `http://host.docker.internal:5522` as the base URL. On Linux, also add `--add-host=host.docker.internal:host-gateway`. `localhost` inside the container refers to the container itself.

For **STDIO**, configure your MCP client to launch this command instead:

```sh
docker run --rm --init -i \
	-e XYOPS_BASE_URL="https://xyops.example.com" \
	-e XYOPS_API_KEY="YOUR_XYOPS_API_KEY" \
	ghcr.io/pixlcore/xycli:latest mcp stdio
```

Keep `-i` so the client can write protocol messages to stdin, and omit `-t` so no terminal is allocated. STDIO uses the supplied API key and needs no published port or HTTP Host allowlist.

Arguments after the image name replace the default `mcp serve --host 0.0.0.0 --port 8080` command. For example, append `mcp serve --host 0.0.0.0 --port 8080 --read-only` to the HTTP example for read-only access. The same image runs other CLI commands; see [Docker](../README.md#docker) for file mounts, configuration, and upgrades.

## Testing with MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) provides a browser interface for browsing tools, inspecting their inputs, and making tool calls.

For **STDIO**, launch Inspector with xyCLI as its server command:

```sh
npx @modelcontextprotocol/inspector xy mcp stdio
```

Inspector launches xyCLI using your existing connection settings and API key. Open the browser URL printed in the terminal (if it doesn't automatically open it for you) and connect to the server.

For **HTTP**, start xyCLI in one terminal:

```sh
xy mcp serve --port 8080
```

Then launch Inspector in another terminal:

```sh
npx @modelcontextprotocol/inspector
```

Open its browser interface and configure the connection:

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `http://127.0.0.1:8080/mcp` |
| Custom header name | `Authorization` |
| Custom header value | `Bearer YOUR_XYOPS_API_KEY` |

After connecting with either transport, open the Tools view and try `list_events` or `get_event_options`. Select a tool to inspect its inputs, submit a call, and view the result.

## Authentication and permissions

Configure the upstream URL through your normal CLI JSON file or `XYOPS_BASE_URL`. For STDIO, supply the API key through `api_key` in that file or `XYOPS_API_KEY`, just like the normal CLI. Keep keys in private configuration or environment variables, rather than prompts or command-line arguments.

Each process connects to one configured xyOps installation. HTTP clients supply their own xyOps API keys using `Authorization: Bearer YOUR_XYOPS_API_KEY` on every request. Each tool forwards that client's key to xyOps as `X-API-Key`, including when a tool makes multiple API calls. Concurrent clients keep their credentials and permissions separate.

HTTP mode does not require a server-side API key and never falls back to one. Missing or malformed bearer headers receive HTTP 401. xyOps rejects invalid keys and unauthorized API operations; these failures are returned as MCP tool errors. Tool discovery is local and does not validate the key upstream or filter tools by its privileges.

A key can permit reading and running existing events without granting `create_events`, `edit_events`, or `delete_events`. This is read-and-execute access. For strict read-only access, also omit `run_jobs` and other write privileges. You can additionally restrict MCP itself:

```sh
xy mcp stdio --read-only
xy mcp serve --port 8080 --read-only
```

Read-only mode omits all mutation/execution tools and rejects direct attempts to call them. Tool annotations describe behavior; actual xyOps privileges remain authoritative.

There is no separate MCP authentication token. HTTP clients must support configured authorization headers. OAuth discovery and interactive login are not provided in this version.

## HTTP configuration

Add an `mcp` object to your existing CLI configuration:

```json
{
	"mcp": {
		"host": "127.0.0.1",
		"port": 8080,
		"read_only": false,
		"max_page_size": 100,
		"max_request_bytes": 1048576,
		"max_result_bytes": 1048576
	}
}
```

| Setting | Default | Purpose |
| --- | --- | --- |
| `host` | `127.0.0.1` | Listener address. Override with `--host`. |
| `port` | `8080` | Listener port. Override with `--port`. |
| `allowed_hosts` | `localhost`, `127.0.0.1`, `[::1]` | Accepted Host header hostnames, without port numbers. Enclose IPv6 addresses in brackets. |
| `allowed_origins` | Empty array | Exact allowed browser origins, including scheme and port. Requests without an Origin header are accepted. |
| `read_only` | `false` | Advertise and accept only read tools. |
| `max_page_size` | `100` | Maximum rows per page, from 1 to 100. |
| `max_request_bytes` | `1048576` | Maximum protocol input size. |
| `max_result_bytes` | `1048576` | Maximum serialized tool data size. Oversized results return an explicit error. |
| `tls_cert`, `tls_key` | Unset | PEM certificate and key files for HTTPS. Supply both together. |

Configuration environment values that look like JSON objects or arrays are parsed as JSON, including `XYOPS_MCP`. Scalar settings accept flat environment overrides such as `XYOPS_MCP_PORT`, `XYOPS_MCP_READ_ONLY`, and `XYOPS_MCP_MAX_RESULT_BYTES`. Configure host/origin arrays in the JSON file. Command-line options override environment variables, which override the `mcp` object.

A non-loopback bind requires an explicit `mcp.allowed_hosts` list. Bearer API keys are required on every HTTP request, including loopback connections. Use HTTPS or a trusted reverse proxy providing TLS for network access. A non-loopback HTTP bind does not automatically encrypt traffic. No permissive browser CORS policy is enabled.

For IPv6 loopback, use `xy mcp serve --host ::1 --port 8080` and connect to `http://[::1]:8080/mcp`. The bind address uses no brackets; URLs and `allowed_hosts` entries use brackets.

For direct HTTPS:

```sh
xy mcp serve --port 8443 --tls-cert /path/to/server.crt --tls-key /path/to/server.key
```

This opens only the HTTPS listener. Restart after replacing certificate files. Unknown routes return 404; local files are never served.

## Tools

| Tool | Purpose |
| --- | --- |
| `list_events` | Find events/workflows by title, category, type or enabled state. Returns summaries and revisions. |
| `get_event` | Fetch a definition and revision. Optional `fields` limits returned properties. |
| `get_event_options` | Discover categories, target groups and event plugins. Optional `plugin_id` adds parameter definitions. |
| `create_event` | Create an ordinary event or workflow from an explicit definition. |
| `update_event` | Apply changes using an exact ID and the revision returned by `get_event`. |
| `delete_event` | Delete an event while retaining historical jobs. Active jobs prevent deletion. |
| `run_event` | Launch an enabled event with a manual trigger, optionally supplying parameters and input data. |
| `get_job` | Inspect job state, completion and output. Optional `fields` selects other job properties. |
| `search_jobs` | Search completed jobs with query, pagination and sorting. |
| `create_ticket` | Create a ticket with a subject, Markdown body and optional classification/assignment. |
| `update_ticket` | Apply only supplied fields to a ticket by exact ID. |
| `delete_ticket` | Permanently delete a ticket by exact ID. |
| `comment_ticket` | Append a Markdown comment with the authenticated key as its author. |
| `search_alerts` | Search active and historical alert invocations, rather than alert definitions. |
| `search_snapshots` | Search server/group snapshots, optionally including verbose monitoring details. |
| `take_snapshot` | Capture the latest monitoring data for exactly one server or group. |
| `list_servers` | List connected workers, optionally filtering by hostname, group or enabled state. |

Pages default to 25 rows, capped by `max_page_size`. Events, servers and lookup collections are paginated locally after fetching the authorized collection; job, alert and snapshot searches are paginated on the server. Each lookup collection has its own total and uses the requested offset/limit.

Updates, deletions and executions require exact IDs. Event creation requires an explicit `enabled` value. Ordinary events require category, plugin, targets and a server-selection algorithm. Workflows require a workflow object with nodes and connections. xyOps validates the full definition and permissions.

Event updates preserve omitted top-level fields. Supplied objects and arrays replace their saved values, including `params`, `triggers` and `workflow`. Read the definition first and include the values you want to retain. Stale revisions are rejected instead of silently overwriting newer changes.

`run_event` returns immediately with a job ID. Use `get_job` until `final` is true, or search with `event:EVENT_ID` or `tags:_error`. Launches accept parameter overrides and `input.data`, but not arbitrary event overrides, test-mode bypasses or local-file uploads.

### Tickets

Create a ticket with `{"ticket":{"subject":"Backup failed","body":"Investigating the logs.","type":"issue"}}`. xyOps generates its ID, number and initial history. Ticket types and statuses follow your xyOps configuration, including custom values. This initial tool set supports text and metadata; file attachments, automatic job/alert templates and attached event definitions are not exposed.

Use `update_ticket` with `{"id":"TICKET_ID","changes":{"status":"closed"}}`. Omitted fields remain unchanged, while arrays such as `assignees`, `cc`, `notify` and `tags` replace their entire lists. Empty arrays clear those lists; an empty `category` or `server` clears that link. `due` is an absolute Unix timestamp in seconds (1980 or later), or `0` to clear it. Unlike events, tickets have no revision precondition, so concurrent edits to the same field can overwrite each other.

Use `comment_ticket` with `{"id":"TICKET_ID","body":"The backup is working again."}`. xyOps assigns the comment author and timestamp. Create/update return ticket summaries; comment also returns the new comment. Creating, updating and commenting may send notifications according to xyOps settings. These operations require `create_tickets`, `edit_tickets` and `delete_tickets` as appropriate; comments require `edit_tickets`.

### Monitoring

`search_alerts` accepts queries such as `active:true`, `server:SERVER_ID` or `start:>=today`. `search_snapshots` accepts queries such as `type:group`, `groups:GROUP_ID` or `source:alert`. Both support `query`, `offset`, `limit`, `sort_by` and `sort_dir` (`1` ascending, `-1` descending), defaulting to newest IDs first. xyOps applies the API key's resource restrictions. Snapshot search omits heavy nested details unless `verbose` is `true`; use small pages with verbose results to stay within the response size limit.

`list_servers` returns connected worker summaries and IDs, excluding offline servers and conductor peers. `hostname` matches a case-insensitive substring, `group` matches an exact group ID, and `enabled` filters the enabled flag.

Use `take_snapshot` with either `{"server":"SERVER_ID"}` or `{"group":"GROUP_ID"}`, never both. This requires `create_snapshots` and stores the most recent monitoring sample; it does not start a watch or force a new sample. The result includes the snapshot ID and target. Group IDs can be found in server summaries or `get_event_options`.

API requests are not automatically retried. A lost connection after a mutation may leave its outcome uncertain; inspect xyOps before repeating it. Cancellation or shutdown does not undo accepted mutations or abort jobs already launched.

## Adding a tool

Every bundled `.js` file in `lib/mcp/tools/` exports:

| Function | Contract |
| --- | --- |
| `describe()` | Synchronously returns `name`, `description`, a plain JSON `inputSchema`, and behavioral `annotations`. No API calls or other side effects. |
| `async run(args, context)` | Returns a JSON-serializable object or throws. Never writes stdout, reads stdin, or exits the process. |

The registry sorts and loads files once, checks exports/names, and compiles schemas. Helpers belong outside the tools directory. Duplicate names or malformed definitions stop startup.

The context supplies `callAPI(name, params)`, `signal`, `log`, and `limits`. HTTP scopes this context to the incoming key. Tool modules must use `context.callAPI()` so every upstream call uses the correct credentials. Add newly required methods to the shared boundary's read/write API allowlists. Calls use the existing SDK. Cancellation prevents subsequent API calls but cannot undo requests already sent.

Both transports invoke the same modules. A tool can combine API calls, simplify inputs and select useful outputs. The runtime validates arguments and returns structured data plus JSON text. Provide pagination or field selection for large results. Keep credentials and raw transport envelopes out of outputs and diagnostics.

## Tests

`npm run test:offline` includes schema, permission-boundary and wire-level STDIO/HTTP/HTTPS checks using fixtures. The TLS key in `test/fixtures/mcp/` is a public test fixture, never a deployment credential.

`node test.js mcp` runs the live suite against `http://localhost:5522`. It requires administrator test credentials, an enabled category, the stock Shell Plugin and a connected worker. It creates disposable events/API keys and a draft ticket, runs a harmless echo job, takes server/group snapshots, verifies restricted-key behavior over STDIO and concurrent HTTP requests, and cleans up its records. Monitoring tests require a worker in a group with a saved monitoring sample. The ticket remains a draft to suppress notifications; the suite deletes only snapshots it created and verifies their removal.
