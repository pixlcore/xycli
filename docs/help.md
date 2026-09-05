# help

Welcome to the xyOps command-line interface. Use `xy` to check your system at a glance, then explore events and jobs with friendly commands designed for both people and scripts.

```sh
xy
xy events
xy jobs
xy keys
xy alerts
xy buckets
xy categories
```

The CLI provides collection commands such as `events`, `jobs`, `keys`, `alerts`, `buckets`, and `categories`, plus singular routers for working with individual resources. Names and titles are matched fuzzily wherever `ID_OR_TITLE` is shown.  You can use the `help` system to get details for each command:

```sh
xy help events
xy help event
xy help event create
xy help jobs
xy help job get
xy help keys
xy help key add
xy help alerts
xy help alerts search
xy help alert
xy help alert create
xy help buckets
xy help bucket
xy help bucket write
xy help categories
xy help category
xy help category create
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

Type `.exit` or hit `Ctrl-C` to exit.

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

## alerts

List alert definitions, or search alert invocations when the next word is `search`. This keeps the common command short while making the resource type clear from the operation and output heading.

```sh
xy alerts
xy alerts list
xy alerts SEARCH_TEXT
xy alerts --enabled false
xy alerts --group ID_OR_TITLE
xy alerts --monitor ID_OR_TITLE
xy alerts search
xy alerts search --active
```

The bare and `list` forms always show definitions. Search text matches definition IDs, titles, expressions, and messages. Definition filters may be combined.

## alerts search

Search historical and active alert invocations. A positional query uses the native xyOps search syntax, while common filters have shorter named options.

```sh
xy alerts search
xy alerts search 'active:true server:SERVER_ID'
xy alerts search --alert ID_OR_TITLE
xy alerts search --server ID_OR_TITLE
xy alerts search --group ID_OR_TITLE
xy alerts search --active
xy alerts search --cleared
xy alerts search --date today
xy alerts search --date 2026-09-01
xy alerts search --job JOB_ID
xy alerts search --ticket TICKET_ID
xy alerts search --oldest
xy alerts search --format json
```

`--alert`, `--server`, and `--group` accept an ID or fuzzy title. Built-in date ranges are `now`, `hour`, `lasthour`, `today`, `yesterday`, `month`, `lastmonth`, `year`, `lastyear`, and `older`. Newest invocations are shown first unless `--oldest` or `--sort asc` is supplied.

Any other named option becomes a native `field:value` search criterion. This provides access to new indexed fields without requiring a CLI release.

## alert

Work with alert definitions and alert invocations through one short command. Operations that create, update, or test always target definitions. Search always targets invocations.

```sh
xy alert ID_OR_TITLE
xy alert get ID_OR_TITLE
xy alert create --title "My Alert" --expression "cpu.currentLoad > 80" --message "CPU is high"
xy alert update DEFINITION_ID --enabled false
xy alert test DEFINITION_ID --server SERVER_ID_OR_TITLE
xy alert delete ALERT_ID --confirm
```

Get and delete can refer to either resource type. The CLI checks the local alert-definition list for an exact ID first. If no definition matches, it treats the ID as an invocation. Get also falls back to a fuzzy definition title when neither exact lookup succeeds.

## alert get

View either an alert definition or alert invocation. A bare selector is the short form of `alert get`.

```sh
xy alert ID_OR_TITLE
xy alert get ID_OR_TITLE
xy alert get ALERT_ID --format json
```

Definition detail includes its expression, message, groups, monitor overlay, behavior flags, revision metadata, and configured actions. Invocation detail includes its definition, server, status, timing, evaluated message and expression, executed actions, snapshots, tickets, and jobs.

## alert create

Create an alert definition. Title, expression, and message are required. The remaining fields use the same defaults as the xyOps web interface.

```sh
xy alert create --title "High CPU" --expression "cpu.currentLoad > 80" --message "CPU is {{pct(cpu.currentLoad)}}"
xy alert create --title "Main Servers" --expression "cpu.cores > 0" --message "Online" --group main
xy alert create --title "Careful" --expression "monitors.load_avg > 10" --message "High load" --samples 3
xy alert create --title "Job Guard" --expression "monitors.load_avg > 20" --message "High load" --limit-jobs --abort-jobs
xy alert create --title "Custom Action" --expression "cpu.cores > 0" --message "Online" --action @action.json
xy alert create --title "Preview" --expression "cpu.cores > 0" --message "Online" --dry
```

Repeat `--group` to restrict the definition to multiple server groups. Use `--monitor ID`, `--samples N`, `--exclusive`, `--limit-jobs`, and `--abort-jobs` for the corresponding definition settings. Actions may be supplied as a complete JSON array in `--actions` or appended as JSON objects with repeated `--action` options.

Alert definitions normally inherit alert actions from matching server groups and the universal configuration. `--exclusive` limits execution to actions stored directly on the definition.

## alert update

Update an alert definition by its exact internal ID. Alert invocations cannot be updated.

```sh
xy alert update DEFINITION_ID --title "New Title"
xy alert update DEFINITION_ID --enabled false
xy alert update DEFINITION_ID --expression "monitors.load_avg > 12" --samples 2
xy alert update DEFINITION_ID --monitor none
xy alert update DEFINITION_ID --group main
xy alert update DEFINITION_ID --exclusive true --limit-jobs false
xy alert update DEFINITION_ID --actions.0.enabled false
xy alert update DEFINITION_ID --delete actions.0.params.example
xy alert update DEFINITION_ID --notes "Preview" --dry
```

Dotted options preserve sibling properties by applying changes to the loaded definition before sending it back to xyOps. Repeat `--delete PATH` to remove nested object properties. Paths are strict, so missing properties and attempts to delete array elements are rejected.

## alert test

Test an alert definition against the current monitor data for one server. This validates the expression and message macros, then shows whether the definition would trigger and previews the evaluated message.

```sh
xy alert test DEFINITION_ID --server SERVER_ID_OR_TITLE
xy alert test "High CPU" --server web-01
xy alert test --server SERVER_ID --expression "cpu.cores > 0" --message "{{os.hostname}} is online"
xy alert test DEFINITION_ID --server SERVER_ID --expression "false"
```

The final two forms provide temporary overrides and do not update the stored definition.

## alert delete

Permanently delete an alert definition or one alert invocation by exact internal ID. Explicit confirmation is always required.

```sh
xy alert delete DEFINITION_ID --confirm
xy alert delete INVOCATION_ID --confirm
xy alert delete ALERT_ID --confirm --dry
```

Deleting an invocation removes only that historical record. Deleting a definition also clears its active and warm state, then starts background deletion of every invocation created from it. The CLI displays this cascading behavior before confirmation and in the success message.

## buckets

List storage bucket definitions and their safe metadata. Bucket data and file lists are loaded only when viewing one bucket.

```sh
xy buckets
xy buckets list
xy buckets SEARCH_TEXT
xy buckets --enabled false
xy buckets --disabled
xy buckets --format json
```

Search text matches bucket IDs, titles, notes, and authors. The first table column contains the complete internal Bucket ID, which is used by all mutating commands.

## bucket

Work with a storage bucket's metadata, JSON data, and files. A bare ID or fuzzy title opens the complete bucket details.

```sh
xy bucket BUCKET_ID_OR_TITLE
xy bucket get BUCKET_ID_OR_TITLE
xy bucket create --title "Build Artifacts"
xy bucket update BUCKET_ID --title "Release Artifacts"
xy bucket write BUCKET_ID --data @data.json
xy bucket upload BUCKET_ID --file report.csv
xy bucket file download BUCKET_ID report.csv
xy bucket file delete BUCKET_ID report.csv --confirm
xy bucket empty BUCKET_ID --data --files --confirm
xy bucket delete BUCKET_ID --confirm
```

The mutation commands deliberately separate metadata, data, and files. Writing data, uploading files, deleting a file, and emptying contents use the dedicated xyOps content APIs, so those actions do not change the bucket revision or modified date.

## bucket get

View a bucket definition together with all current JSON data and file metadata. The file list includes complete File IDs and normalized filenames.

```sh
xy bucket BUCKET_ID_OR_TITLE
xy bucket get BUCKET_ID_OR_TITLE
xy bucket get BUCKET_ID --format json
```

The JSON response contains `bucket`, `data`, and `files` properties.

## bucket create

Create a storage bucket with optional initial JSON data and files. The title is required. Status, icon, and notes use the same fields as the web interface.

```sh
xy bucket create --title "Build Artifacts"
xy bucket create --title "Disabled Bucket" --enabled false
xy bucket create --title "Release Data" --icon archive --notes "Production releases"
xy bucket create --title "Counters" --data.count 1 --data.status ready
xy bucket create --title "From Data" --data @data.json
cat data.json | xy bucket create --title "From STDIN" --data @-
xy bucket create --json @bucket.json
xy bucket create --title "With Files" --file report.csv --file summary.txt
xy bucket create --title "Preview" --data @data.json --file report.csv --dry
```

Initial data is stored as part of revision 1. Files are uploaded through the dedicated file API immediately after the bucket is created. If a file upload fails, the new bucket remains available so the upload can be retried with `bucket upload`.

## bucket update

Update bucket metadata using the exact internal Bucket ID.

```sh
xy bucket update BUCKET_ID --title "Release Artifacts"
xy bucket update BUCKET_ID --enabled false
xy bucket update BUCKET_ID --icon archive --notes "Production releases"
xy bucket update BUCKET_ID --notes "Preview" --dry
```

This command only accepts `title`, `enabled`, `icon`, and `notes`. Use `bucket write` for JSON data and the file commands for file contents. Metadata updates advance the bucket revision and modified date.

## bucket write

Shallow-merge a JSON object into a bucket's existing data using the dedicated data API. The exact internal Bucket ID is required.

```sh
xy bucket write BUCKET_ID --data.status ready --data.build 42
xy bucket write BUCKET_ID --data @data.json
cat data.json | xy bucket write BUCKET_ID --data @-
xy bucket write BUCKET_ID --json @request.json
cat request.json | xy bucket write BUCKET_ID --json @-
xy bucket write BUCKET_ID --data @data.json --format json
```

`--data @-` treats the piped object as the bucket data itself. The `--json` forms accept a complete request object containing a `data` property. As with the xyOps API, this is a shallow merge. Existing top-level keys not present in the input are preserved.

## bucket upload

Upload one or more local files without changing bucket metadata. Existing files with the same normalized filename are replaced.

```sh
xy bucket upload BUCKET_ID --file report.csv
xy bucket upload BUCKET_ID --file report.csv --file summary.txt
xy bucket upload BUCKET_ID --files '["report.csv", "summary.txt"]'
xy bucket upload BUCKET_ID --file report.csv --dry
```

xyOps normalizes uploaded filenames to lowercase and replaces unsupported characters with underscores. Server-configured file count, size, and type limits still apply.

## bucket file

Download or permanently delete one file. Supply either the exact normalized filename or the internal File ID shown by `bucket get`.

```sh
xy bucket file download BUCKET_ID report.csv
xy bucket file download BUCKET_ID FILE_ID ./downloads/report.csv
xy bucket file delete BUCKET_ID report.csv --confirm
xy bucket file delete BUCKET_ID FILE_ID --confirm
```

## bucket file download

Download a bucket file to disk. The output path defaults to the stored filename in the current directory, or it can be supplied as the final positional argument, with `--output`, or with `--download`.

```sh
xy bucket file download BUCKET_ID report.csv
xy bucket file download BUCKET_ID report.csv ./downloads/report.csv
xy bucket file download BUCKET_ID report.csv --output ./report-copy.csv
xy bucket download BUCKET_ID report.csv --download ./report-copy.csv
xy bucket file download BUCKET_ID report.csv --dry
```

The command refuses to overwrite an existing local file.

## bucket file delete

Permanently delete one bucket file. Explicit confirmation is required.

```sh
xy bucket file delete BUCKET_ID report.csv --confirm
xy bucket file delete BUCKET_ID FILE_ID --confirm
xy bucket file delete BUCKET_ID report.csv --confirm --dry
```

Deleting a file uses the dedicated content API and does not advance the bucket revision or modified date.

## bucket empty

Permanently clear all data, all files, or both while keeping the bucket definition. Explicit confirmation is required.

```sh
xy bucket empty BUCKET_ID --data --confirm
xy bucket empty BUCKET_ID --files --confirm
xy bucket empty BUCKET_ID --data --files --confirm
xy bucket empty BUCKET_ID --all --confirm
xy bucket empty BUCKET_ID --all --confirm --dry
```

Emptying contents uses the dedicated content API and does not advance the bucket revision or modified date.

## bucket delete

Permanently delete a bucket definition together with all of its data and files. The exact internal Bucket ID and explicit confirmation are required.

```sh
xy bucket delete BUCKET_ID --confirm
xy bucket delete BUCKET_ID --confirm --dry
```

Bucket deletion cannot be undone.

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
xy key update KEY_ID --delete privileges.tag_jobs
xy key update KEY_ID --delete privileges.tag_jobs --delete privileges.run_jobs
xy key update KEY_ID --role ROLE_ID
xy key update KEY_ID --roles '[]'
xy key update KEY_ID --rate 25 --expires "2027-01-01"
xy key update KEY_ID --expires never
xy key update KEY_ID --description "Preview" --dry
```

Repeat `--delete PATH` to remove one or more existing nested object properties. Paths are strict, so missing properties and attempts to delete array elements are rejected. Setting a dotted privilege to `false` also removes it from the privilege hash.

Pass a complete privilege object or roles array when you want to replace the current collection. For example, `--roles '[]'` removes all roles. The API Key secret cannot be updated. Create a replacement key instead.

## key delete

Permanently delete an API Key using its exact internal ID. Explicit confirmation is required.

```sh
xy key delete KEY_ID --confirm
xy key delete KEY_ID --confirm --dry
```

Deletion cannot be undone. Any service using the deleted key immediately loses access.

## categories

List categories in their saved sort order, including IDs, titles, status, event counts, authors, and modification times. Search text matches IDs, titles, and notes. Named filters may be combined.

```sh
xy categories
xy categories SEARCH_TEXT
xy categories --enabled false
xy categories --color blue
xy categories --title Production --enabled true
xy categories --limit 10 --page 2
xy categories --format json
```

Use `--limit`, `--page`, or `--offset` to page through the table. JSON output includes all matching category definitions. Event counts reflect the events visible to your API Key.

## category

View, create, update, or delete a category. A bare ID or fuzzy title opens its details. Updates and deletes require an exact category ID.

```sh
xy category CAT_ID_OR_TITLE
xy category get CAT_ID_OR_TITLE
xy category list
xy category create --title "My Category" --notes "Hello"
xy category update CAT_ID --enabled false
xy category delete CAT_ID --confirm
```

## category list

List and filter categories. This is an alias for `xy categories`, with the same options.

```sh
xy category list
xy category list --enabled true
xy category list --limit 10 --page 2
```

## category get

View category metadata and its configured actions and limits. Each array row includes a zero-based index you can use in dotted updates. An exact ID takes precedence over fuzzy title matching.

```sh
xy category CAT_ID_OR_TITLE
xy category get --id CAT_ID
xy category get --title "My Category"
xy category CAT_ID --format json
xy events --category CAT_ID
```

The action and limit tables show the category's own settings. These apply to jobs belonging to the category alongside event settings and universal defaults.

## category create

Create a category with a required title. New categories default to enabled, plain color, empty notes and icon, and empty action and limit arrays. xyOps generates an ID unless you provide `--id`, and places the category at the end of the saved sort order.

```sh
xy category create --title "My Category" --notes "Hello"
xy category create --id maintenance --title "Maintenance" --enabled false
xy category create --title "Production" --color blue --icon folder-outline
xy category create --title "Notifications" --action '{ "type":"email", "enabled":true, "condition":"success", "users":["admin"] }'
xy category create --title "Short Jobs" --limit '{ "type":"time", "enabled":true, "duration":300, "abort":true }'
xy category create --title "Imported Settings" --actions @actions.json --limits @limits.json
xy category create --json @category.json
cat category.json | xy category create --json @-
xy category create --title "Preview" --dry
```

Supported creation fields are `id`, `title`, `enabled`, `color`, `icon`, `notes`, `actions`, and `limits`. Common colors include `plain`, `red`, `orange`, `yellow`, `green`, `blue`, and `purple`. Set `color` to `false` in your CLI configuration to disable terminal colors (for example, `xy config --color false`). The category `--color` option sets the category color.

As with events, `--actions` and `--limits` supply complete JSON arrays, while `--action` and `--limit` append objects. Singular options can be repeated. Here `--limit` is a resource limit object, while list commands use it for pagination. xyOps validates the action types, conditions, targets, and limit values. Add `--format json` to print the created category object.

## category update

Update a category by exact ID. Only the selected top-level fields are sent to xyOps. Dotted updates load the current arrays and preserve the other entries and properties.

```sh
xy category update CAT_ID --title "New Title" --notes "Updated notes"
xy category update CAT_ID --enabled false
xy category update CAT_ID --color green --icon folder-outline
xy category update CAT_ID --actions.0.condition complete --actions.0.enabled true
xy category update CAT_ID --action '{ "type":"email", "enabled":true, "condition":"success", "users":["admin"] }'
xy category update CAT_ID --limits.0.duration 600
xy category update CAT_ID --limit '{ "type":"time", "enabled":true, "duration":300, "abort":true }'
xy category update CAT_ID --actions @actions.json --limits @limits.json
xy category update CAT_ID --actions '[]' --limits '[]'
xy category update --id CAT_ID --sort_order 0
xy category update CAT_ID --enabled false --dry
```

Editable fields are `title`, `enabled`, `color`, `icon`, `notes`, `sort_order`, `actions`, and `limits`. The ID and server-managed audit fields cannot be changed. `sort_order` is a non-negative integer and does not renumber other categories.

Numerical array indexes must already exist. Use the singular `--action` or `--limit` option to append, or the plural option to replace an entire array. Supply `[]` to clear an array; to remove one entry, submit a replacement array without it. When combining array replacement and dotted edits, the replacement is applied first, followed by dotted edits and then singular appends.

Disabling a category prevents scheduling and manual launches for all its events and workflows. `--dry` previews the outgoing request. `--format json` prints the API success response.

## category delete

Permanently delete a category by exact ID. Explicit confirmation is required, and xyOps refuses deletion while any events or workflows still belong to the category. Move or delete those events first.

```sh
xy category delete CAT_ID --confirm
xy category delete --id CAT_ID --confirm
xy category delete CAT_ID --confirm --dry
```

`--dry` previews the request without deleting anything. `--format json` prints the API success response.

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
