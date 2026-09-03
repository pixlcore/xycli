# help

Welcome to the xyOps command-line interface. Use `xy` to check your system at a glance, then explore events and jobs with friendly commands designed for both people and scripts.

```sh
xy
xy events
xy jobs
xy keys
```

The CLI provides collection commands such as `events`, `jobs`, and `keys`, plus singular routers for working with one event, job, or API Key. Names and titles are matched fuzzily wherever `ID_OR_TITLE` is shown.  You can use the `help` system to get details for each command:

```sh
xy help events
xy help event
xy help event create
xy help jobs
xy help job get
xy help keys
xy help key add
```

# Command Reference

## api

Call any API method exposed by the xyOps SDK and print its JSON request and response. Named options become request properties, and dotted names provide a convenient way to build nested objects.

```sh
xy api getEvents
xy api getJob --id JOB_ID
xy api runEvent --id EVENT_ID --params.example VALUE
xy api updateEvent --json @request.json
cat request.json | xy api runEvent --json @-
xy api runEvent --id EVENT_ID --dry
```

Use the SDK's camel-case method names, such as `getEvents`, `getJob`, and `runEvent`. Add `--dry` to print a request without calling the API.

## repl

Open an interactive Node.js prompt with the current xyOps client state already loaded. This is primarily a development and debugging tool for exploring objects and trying utility methods.

```sh
xy repl
```

The REPL exposes `app`, `xy`, `config`, `cli`, and `Tools` in its context.

## config

View the effective CLI configuration or save one or more user settings. API keys are masked when displayed, and updated values are written to `~/.config/xyops/cli.json`.

```sh
xy config
xy config --suggest false
xy config --color false
xy config --items_per_page 25
xy config --base_url http://localhost:5522 --api_key YOUR_API_KEY
```

Configuration may also come from `/etc/xyops/cli.json` and `XYOPS_`-prefixed environment variables. Common keys include `api_key`, `base_url`, `temp_dir`, `color`, `suggest`, `items_per_page`, `cache_ttl`, `raw`, and `invisible`.

## dashboard

Show the main xyOps dashboard, including server health, active alerts and jobs, queued work, and active rate limits. Add the upcoming view when you also want to see jobs expected to run soon.

```sh
xy
xy dashboard
xy dashboard --upcoming
xy dashboard upcoming
xy upcoming
```

## upcoming

Show the main dashboard with the upcoming-jobs section included. This is a convenient shortcut for `xy dashboard --upcoming`.

```sh
xy upcoming
xy dashboard --upcoming
```

## keys

List API Keys and their safe metadata. The plaintext secret is never included. You can search by ID, title, description, or partial key, and filter by status, direct privilege, or role ID.

```sh
xy keys
xy keys SEARCH_TEXT
xy keys --active false
xy keys --expired true
xy keys --privilege run_jobs
xy keys --role ROLE_ID
xy keys --format json
```

The list includes the internal Key ID, which is safe to display and is used by update and delete commands. `--active false` includes disabled keys. `--expired true` includes enabled or disabled keys whose expiration time has passed.

## key

Work with one API Key by viewing, adding, updating, or deleting it. A bare ID or fuzzy title opens the key details directly.

```sh
xy key KEY_ID_OR_TITLE
xy key get KEY_ID_OR_TITLE
xy key add --title "My App" --privileges.admin
xy key update KEY_ID --active false
xy key delete KEY_ID --confirm
```

Updates and deletes require the exact internal Key ID. The authentication secret itself can never be updated or retrieved.

## key get

View one API Key's safe metadata, including its partial key, status, privileges, roles, rate limit, expiration, and last-used time. The stored key hash and plaintext secret are never displayed.

```sh
xy key KEY_ID_OR_TITLE
xy key get KEY_ID_OR_TITLE
xy key get KEY_ID --format json
```

## key add

Create a new API Key. xyOps generates the authentication secret and the CLI displays it exactly once. Copy it immediately and store it securely.

```sh
xy key add --title "My App"
xy key add --title "Admin Tool" --privileges.admin
xy key add --title "Runner" --privileges.run_jobs --description "Production runner"
xy key add --title "Service" --privilege run_jobs --privilege tag_jobs
xy key add --title "Service" --role ROLE_ID --rate 10
xy key add --title "Temporary" --expires "2026-12-31"
xy key add --title "Dormant" --active false
xy key add --title "From JSON" --json @key.json
xy key add --title "Preview" --dry
```

Without an explicit privilege selection, new keys inherit the server's default user privileges. Use dotted options such as `--privileges.admin`, a JSON object in `--privileges`, or repeat `--privilege PRIVILEGE_ID`. Selecting `admin` removes redundant direct privileges because administrators already have every privilege.

Roles can be supplied using `--roles ROLE_ID_1,ROLE_ID_2`, a JSON array, or repeated `--role ROLE_ID` options. `--rate 0` means unlimited. Expiration accepts a date or time understood by Node.js, a Unix timestamp, or `never`.

With `--format json`, the one-time secret is returned as `plain_key`; the accompanying `api_key` object contains safe metadata only.

## key update

Update an API Key using its exact internal ID. Dotted privilege options preserve the key's other direct privileges.

```sh
xy key update KEY_ID --title "New App Title"
xy key update KEY_ID --active false
xy key update KEY_ID --privileges.run_jobs true
xy key update KEY_ID --privileges.tag_jobs false
xy key update KEY_ID --role ROLE_ID
xy key update KEY_ID --roles '[]'
xy key update KEY_ID --rate 25 --expires "2027-01-01"
xy key update KEY_ID --expires never
xy key update KEY_ID --description "Preview" --dry
```

Setting a dotted privilege to `false` removes it from the privilege hash. Pass a complete privilege object or roles array when you want to replace the current collection. For example, `--roles '[]'` removes all roles. The API Key secret cannot be updated. Create a replacement key instead.

## key delete

Permanently delete an API Key using its exact internal ID. Explicit confirmation is required.

```sh
xy key delete KEY_ID --confirm
xy key delete KEY_ID --confirm --dry
```

Deletion cannot be undone. Any service using the deleted key immediately loses access.

## events

List all events or narrow the collection using fuzzy names, titles, categories, plugins, and targets. Filters may be combined to find exactly the events you need.

```sh
xy events
xy events SEARCH_TEXT
xy events --category ID_OR_TITLE
xy events --plugin ID_OR_TITLE
xy events --target ID_OR_TITLE
xy events --category ID_OR_TITLE --plugin ID_OR_TITLE
```

`SEARCH_TEXT` performs a fuzzy title search. `--target` accepts either a server group or an individual server.

## event

Work with one event by viewing, creating, updating, deleting, or running it. The event router accepts the operation as its next argument, while a bare ID or title opens the event details directly.

```sh
xy event ID_OR_TITLE
xy event get ID_OR_TITLE
xy event create --title "My Event" --plugin testplug
xy event update EVENT_ID --enabled false
xy event delete EVENT_ID --confirm
xy event run ID_OR_TITLE
```

## event get

View the configuration and current activity for a single event. Optional switches can focus the output on queued, upcoming, or completed jobs for that event.

```sh
xy event ID_OR_TITLE
xy event get ID_OR_TITLE
xy event ID_OR_TITLE --queued
xy event ID_OR_TITLE --upcoming
xy event ID_OR_TITLE --completed
```

`xy event ID_OR_TITLE` is the short form of `xy event get ID_OR_TITLE`.

## event create

Create a new event from command-line options, with sensible defaults filled in where possible. Convenience options make it easy to add common triggers without constructing the complete event object yourself.

```sh
xy event create --title "Foo" --plugin testplug --params.duration 30
xy event create --title "Script" --plugin shellplug --params.script @script.sh
xy event create --title "Daily" --cron "30 4 * * *" --seconds 15
xy event create --title "Interval" --interval "5 minutes" --catchup
xy event create --title "Preview" --plugin testplug --dry
```

The CLI fills in default category, plugin, target, and algorithm values where possible. Dotted options create nested properties, while options such as `--cron`, `--interval`, `--seconds`, and `--catchup` create corresponding triggers.

## event update

Update an existing event using an ID or fuzzy title, with support for both ordinary properties and deeply nested values. You can also append common event objects using their singular convenience options.

```sh
xy event update EVENT_ID --title "New Title"
xy event update EVENT_ID --params.duration 15
xy event update EVENT_ID --actions.0.condition complete --actions.0.enabled true
xy event update EVENT_ID --action '{ "type":"email", "enabled":true, "condition":"success", "users":["admin"] }'
xy event update EVENT_ID --field '{ "id":"foo", "title":"Foo", "type":"text", "value":"hello" }'
xy event update EVENT_ID --magic
xy event update EVENT_ID --enabled false --dry
```

Dotted options are applied directly to the loaded event, and numerical array indexes must already exist. The singular `--action`, `--trigger`, `--limit`, and `--field` options append new objects to their corresponding arrays.

## event delete

Permanently delete an event using its exact ID. The command requires explicit confirmation and can optionally remove the event's historical jobs in the background.

```sh
xy event delete EVENT_ID --confirm
xy event delete EVENT_ID --delete_jobs --confirm
xy event delete EVENT_ID --confirm --dry
```

Deletion is blocked while the event has active jobs. Use `--dry` to inspect the request without deleting anything.

## event run

Launch an event on demand, optionally overriding parameters, attaching files, or providing input data. Add `--follow` to stream the resulting job until it completes.

```sh
xy run ID_OR_TITLE
xy event run ID_OR_TITLE
xy run ID_OR_TITLE --follow
xy run ID_OR_TITLE --dry
xy run ID_OR_TITLE --file ./input.txt
xy run ID_OR_TITLE --file ./one.txt --file ./two.txt
xy run ID_OR_TITLE --params.example VALUE
xy run ID_OR_TITLE --input.data.example VALUE
xy run ID_OR_TITLE --actions @my-actions.json
cat request.json | xy run ID_OR_TITLE --json @-
```

`xy run` is the short form of `xy event run`. Extra options are passed to the run request as event overrides, and dotted option names create nested properties.

## run

Run an event on demand using the short top-level command. It accepts the same event selector, overrides, files, input data, dry-run mode, and follow mode as `xy event run`.

```sh
xy run ID_OR_TITLE
xy run ID_OR_TITLE --params.example VALUE
xy run ID_OR_TITLE --file ./input.txt
xy run ID_OR_TITLE --follow
xy run ID_OR_TITLE --dry
```

## jobs

Show active jobs and search recent completed jobs using either structured filters or the raw xyOps job-search syntax. With no filters, the command displays active jobs followed by recent completed jobs.

```sh
xy jobs
xy jobs RAW_SEARCH_QUERY
xy jobs upcoming
xy jobs --upcoming
xy jobs --success
xy jobs --error --date today
xy jobs --workflows
xy jobs --category ID_OR_TITLE
xy jobs --event ID_OR_TITLE --date yesterday
```

Common filters:

| Option | Matches |
| --- | --- |
| `--event ID_OR_TITLE` | Event |
| `--category ID_OR_TITLE` | Category |
| `--plugin ID_OR_TITLE` | Plugin |
| `--server ID_OR_TITLE` | Server ID, title, hostname, or IP address |
| `--group ID_OR_TITLE` | Server group |
| `--tag ID_OR_TITLE` | Tag |
| `--success` | Successful jobs |
| `--error` | Failed jobs |
| `--files` | Jobs with attached files |
| `--warning` | Warning result code |
| `--critical` | Critical result code |
| `--abort` | Aborted jobs |
| `--workflow` or `--workflows` | Workflow jobs |
| `--date RANGE` | Completion date or date expression |

Built-in date ranges are `now`, `hour`, `lasthour`, `today`, `yesterday`, `month`, `lastmonth`, `year`, `lastyear`, and `older`.

## job

Work with one job by viewing, streaming, rerunning, resuming, aborting, deleting, or downloading its output. A bare job ID automatically chooses the live stream or completed report based on the job's current state.

```sh
xy job JOB_ID
xy job get JOB_ID
xy job stream JOB_ID
xy job log JOB_ID
xy job run JOB_ID --follow
xy job resume JOB_ID
xy job abort JOB_ID
xy job delete JOB_ID
```

## job get

View a job in its current state using either the short or explicit form. Active jobs automatically switch to streaming, while completed jobs display their full report.

```sh
xy job JOB_ID
xy job get JOB_ID
xy job JOB_ID --verbose
xy job JOB_ID --format json
```

## job stream

Stream the live status and output of an active job until it completes. If the job has already completed, the command automatically displays its completed report instead.

```sh
xy job stream JOB_ID
```

## job log

Print the raw output log for a job or download it directly to a file. This is useful when the job report only shows an output summary or when another tool needs the unformatted log.

```sh
xy job log JOB_ID
xy job log JOB_ID --download JOB_ID.log
```

## job run

Rerun a completed, event-backed job using its previous execution context. Add `--follow` to stream the new job, or use `--dry` to inspect the generated run request first.

```sh
xy job run JOB_ID
xy job run JOB_ID --follow
xy job run JOB_ID --dry
```

Ad hoc jobs and ad hoc workflow sub-jobs cannot be rerun independently.

## job resume

Resume a suspended active job, optionally providing new parameter or input values. Dotted options are expanded into nested request properties before the job is resumed.

```sh
xy job resume JOB_ID
xy job resume JOB_ID --params.example VALUE
xy job resume JOB_ID --input.data.example VALUE
xy job resume JOB_ID --dry
```

## job abort

Abort an active job that should no longer continue running. Use dry-run mode when you want to inspect the request without interrupting the job.

```sh
xy job abort JOB_ID
xy job abort JOB_ID --dry
```

## job delete

Permanently delete a completed job, including its stored output and attached files. Active jobs must be aborted and allowed to finish before they can be deleted.

```sh
xy job delete JOB_ID
xy job delete JOB_ID --dry
```
