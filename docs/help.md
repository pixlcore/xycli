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
xy channels
xy log xyOps --rows 100
xy monitors
xy event EVENT_ID --export event.json
xy import event.json
```

The CLI provides collection commands such as `events`, `jobs`, `keys`, `alerts`, `buckets`, `categories`, `channels`, and `monitors`, plus singular routers for working with individual resources. Names and titles are matched fuzzily wherever `ID_OR_TITLE` is shown.  You can use the `help` system to get details for each command:

```sh
xy help events
xy help event
xy help event create
xy help jobs
xy help job get
xy help keys
xy help key create
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
xy help channels
xy help channel
xy help channel create
xy help log
xy help monitors
xy help monitor
xy help monitor create
xy help monitor test
xy help export
xy help import
```

# Command Reference

## export

Export an object to an xyOps Portable Data Format (XYPDF) file by adding `--export FILE` to its detail command. The file can be imported by the CLI or the xyOps web interface. Exact IDs take precedence over fuzzy titles.

```sh
xy event EVENT_ID_OR_TITLE --export event.json
xy event get --id EVENT_ID --export event.json
xy category CATEGORY_ID --export category.json
xy bucket BUCKET_ID --export bucket.json
xy monitor MONITOR_ID --export monitor.json.gz
xy event EVENT_ID --export event.json --overwrite
xy event EVENT_ID --export event.json --dry
```

Export supports all XYPDF object types:

| Object | Command |
|--------|---------|
| Alert definition | `xy alert ALERT_ID --export alert.json` |
| API key | `xy key KEY_ID --export key.json` |
| Bucket metadata | `xy bucket BUCKET_ID --export bucket.json` |
| Category | `xy category CATEGORY_ID --export category.json` |
| Notification channel | `xy channel CHANNEL_ID --export channel.json` |
| Event or workflow | `xy event EVENT_ID --export event.json` |
| Server group | `xy group GROUP_ID --export group.json` |
| Monitor | `xy monitor MONITOR_ID --export monitor.json` |
| Plugin | `xy plugin PLUGIN_ID --export plugin.json` |
| Role | `xy role ROLE_ID --export role.json` |
| Tag | `xy tag TAG_ID --export tag.json` |
| Web hook | `xy webhook WEB_HOOK_ID --export hook.json` |

The export variant is available for every command above, even when its other resource commands have not yet been implemented. Use it with a single object's details, rather than a list, search, or mutation command. `--id` and `--title` selectors are also supported.

Files are pretty-printed JSON. A `.gz` suffix enables gzip compression; use `.json.gz` for compatibility with the web interface. The destination directory must exist. Existing files are preserved unless you pass `--overwrite`. `--dry` prints the proposed payload without writing a file. `--format json` prints a result containing the output path, item count, and any dependency warnings.

Exports omit `created`, `modified`, `revision`, `sort_order`, and `username`. Buckets include only their definition, without stored JSON data or uploaded files. API keys retain their `id`, stored `key` hash, and `mask` for restoration by xyOps. Alert exports contain definitions, rather than active alert invocations.

**Event and workflow dependencies**

Events and workflows export by themselves unless you select dependency types with `--deps`. Use a comma-separated list, repeated options, or `all`:

```sh
xy event EVENT_ID --export event.json --deps plugins,categories
xy event WORKFLOW_ID --export workflow.json.gz --deps events,plugins,buckets
xy event WORKFLOW_ID --export workflow.json --deps events --deps plugins
xy event WORKFLOW_ID --export workflow.json --deps all
```

| Dependency | Included objects |
|------------|------------------|
| `events` | Events referenced by workflow event nodes, recursively. |
| `plugins` | Event and workflow job plugins, plus plugins referenced by triggers and actions. |
| `categories` | Event categories, excluding the built-in General category. |
| `groups` | Server groups in event targets. Individual servers are not portable. |
| `buckets` | Bucket metadata referenced by store and fetch actions. |
| `tags` | Event tags and tags referenced by actions. |
| `web_hooks` | Web hooks referenced by actions, excluding the built-in example hook. |

These choices match the web interface. Workflow action nodes are included in dependency discovery. Stock event and job plugins are omitted. Only the selected dependency types are collected; references in categories, groups, and other included definitions are not recursively expanded. Shared dependencies appear once, and circular workflow references are handled without recursion errors. Missing selected dependencies are reported as warnings and omitted from the file.

## import

Read a plain JSON or gzip-compressed XYPDF file and preview its contents and planned API calls. **No changes are made until you add `--confirm`.** Review the complete data, including plugin scripts and event triggers, before importing files from another source.

```sh
xy import event.json
xy import workflow.json.gz
xy import workflow.json.gz --format json
xy import workflow.json.gz --confirm
xy import workflow.json.gz --confirm --dry
xy import workflow.json.gz --confirm --format json
```

The file determines the object types and may contain any combination of the 12 types supported by `xy help export`. Workflows use the `event` item type. The CLI validates the wrapper, minimum xyOps version, item types, titles, IDs, and duplicate IDs before making changes. It accepts the same `version: "1.0"` wire format as the web interface, including the optional `xyops` minimum-version field.

An exact matching ID selects an update; otherwise the CLI creates the object. Missing or empty IDs are generated by xyOps. Titles are not used to select updates. As in the web interface, updates merge the imported fields into the existing definition. Omitted fields remain unchanged, while included arrays replace their existing values. Audit metadata is removed before each API call.

Import starts with the web interface's reverse file order, moving new dependencies ahead of the objects that need them. This also handles shared nested workflow dependencies. Circular dependencies among new objects are rejected during preview; references to existing definitions are allowed. Importing a bucket never writes or clears its stored data or files. API key definitions are passed through like other object types, including `id`, `key`, and `mask`; restoring a new key requires an xyOps version that preserves these fields on import.

The preview identifies updates and events with active triggers. Confirmed imports preserve the settings in the file, so enabled schedules or other triggers can run automatically afterward. `--dry` always previews, even with `--confirm`.

Import uses the normal create and update APIs with your configured credentials. Server-side validation and privileges still apply. If an API call fails, import stops and reports each item's result: `created`, `updated`, `failed`, or `pending`. Earlier successful changes remain in place; there is no automatic rollback. JSON reports include these results, and failed imports exit with a nonzero status.

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
xy alert ALERT_DEFINITION_ID --export alert.json
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
xy bucket BUCKET_ID --export bucket.json
```

The JSON response contains `bucket`, `data`, and `files` properties. The `--export` variant writes only the bucket definition to XYPDF; see `xy help export`.

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

Work with one API Key by viewing, creating, updating, or deleting it. A bare ID or fuzzy title opens the key details directly.

```sh
xy key KEY_ID_OR_TITLE
xy key get KEY_ID_OR_TITLE
xy key create --title "My App" --privileges.admin
xy key update KEY_ID --active false
xy key delete KEY_ID --confirm
```

Updates and deletes require the exact internal Key ID. The authentication secret itself can never be updated or retrieved.

## key get

View one API Key's safe metadata, including its partial key, status, privileges, roles, rate limit, expiration, and last-used time. Normal detail output omits the stored key hash and plaintext secret. The `--export` variant preserves the key definition for restoration; see `xy help export`.

```sh
xy key KEY_ID_OR_TITLE
xy key get KEY_ID_OR_TITLE
xy key get KEY_ID --format json
xy key KEY_ID --export key.json
```

## key create

Create a new API Key. xyOps generates the authentication secret and the CLI displays it exactly once. Copy it immediately and store it securely.

```sh
xy key create --title "My App"
xy key create --title "Admin Tool" --privileges.admin
xy key create --title "Runner" --privileges.run_jobs --description "Production runner"
xy key create --title "Service" --privilege run_jobs --privilege tag_jobs
xy key create --title "Service" --role ROLE_ID --rate 10
xy key create --title "Temporary" --expires "2026-12-31"
xy key create --title "Dormant" --active false
xy key create --title "From JSON" --json @key.json
xy key create --title "Preview" --dry
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
xy category CAT_ID --export category.json
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

## channels

List notification channels alphabetically by title, including IDs, status, subscribed-user counts, daily caps, and modification times. Search text matches IDs, titles, notes, and email recipients.

```sh
xy channels
xy channels SEARCH_TEXT
xy channels --enabled false
xy channels --user admin
xy channels --title Production --enabled true
xy channels --limit 10 --page 2
xy channels --format json
```

Named filters can be combined. `--user` matches a complete username; repeat it to require multiple subscribed users. `--limit`, `--page`, and `--offset` page through the table. JSON output includes all matching channel definitions.

## channel

View, create, update, or delete a notification channel. A bare ID or fuzzy title opens its details. Updates and deletes require an exact channel ID.

```sh
xy channel CHANNEL_ID_OR_TITLE
xy channel get CHANNEL_ID_OR_TITLE
xy channel list
xy channel create --title "Operations" --users admin
xy channel update CHANNEL_ID --enabled false
xy channel delete CHANNEL_ID --confirm
```

Channels bundle email recipients, in-app notifications, an optional web hook, and an optional follow-up event. They run when referenced by an event, category, or alert action. Creating or updating a channel only changes its configuration.

## channel list

List and filter notification channels using the same options as `xy channels`.

```sh
xy channel list
xy channel list --user admin --enabled true
xy channel list --limit 10 --page 2
```

## channel get

View a channel's recipients, web hook, follow-up event, sound, daily cap, notes, and revision metadata. Exact IDs take precedence over fuzzy title matches.

```sh
xy channel CHANNEL_ID_OR_TITLE
xy channel get --id CHANNEL_ID
xy channel get --title "Operations"
xy channel CHANNEL_ID --format json
xy channel CHANNEL_ID --export channel.json
```

## channel create

Create a channel with a required title. Defaults are enabled, no recipients or follow-up actions, no sound, empty icon and notes, and an unlimited daily cap. xyOps generates the ID unless you supply `--id`.

```sh
xy channel create --title "Operations" --users admin
xy channel create --title "On Call" --users 'admin,oncall' --email 'ops@example.com,sre@example.com'
xy channel create --id production --title "Production" --user admin --user oncall
xy channel create --title "Remediation" --web_hook WEB_HOOK_ID --run_event EVENT_ID
xy channel create --title "Urgent" --users '["admin"]' --sound attention-3.mp3 --max_per_day 100
xy channel create --title "Quiet" --enabled false --icon bullhorn-outline --notes "Staging notifications"
xy channel create --json @channel.json
cat channel.json | xy channel create --json @-
xy channel create --title "Preview" --dry
```

Supported fields are `id`, `title`, `enabled`, `icon`, `users`, `email`, `web_hook`, `run_event`, `sound`, `max_per_day`, and `notes`. Use usernames in `users`, a comma-separated string for extra `email` recipients, and exact resource IDs for `web_hook` and `run_event`. `sound` is an optional `.mp3` filename available on your xyOps server.

`--users` accepts a JSON array, a comma-separated string, or `@users.json`. Repeated `--user USERNAME` options append subscribed users without duplicates. `max_per_day` must be a non-negative integer; `0` means unlimited. The daily cap resets at midnight in the server's time zone. Add `--format json` to print the created channel object.

To use the channel in a job or alert action:

```sh
xy event update EVENT_ID --action '{ "type":"channel", "enabled":true, "condition":"error", "channel_id":"CHANNEL_ID" }'
xy alert update ALERT_ID --action '{ "type":"channel", "enabled":true, "condition":"alert_new", "channel_id":"CHANNEL_ID" }'
```

## channel update

Update a channel by exact ID. Only the selected fields are sent to xyOps, preserving unrelated settings. The ID and server-managed audit fields cannot be changed.

```sh
xy channel update CHANNEL_ID --title "Production Operations" --notes "On-call team"
xy channel update CHANNEL_ID --enabled false
xy channel update CHANNEL_ID --users '["admin","oncall"]'
xy channel update CHANNEL_ID --user admin --user oncall
xy channel update CHANNEL_ID --users.0 admin
xy channel update CHANNEL_ID --max_per_day 50 --sound attention-3.mp3
xy channel update CHANNEL_ID --email '' --web_hook '' --run_event '' --sound ''
xy channel update CHANNEL_ID --users '[]'
xy channel update --id CHANNEL_ID --json @changes.json
xy channel update CHANNEL_ID --enabled false --dry
```

`--users` replaces the complete user list, `--user` appends users, and dotted paths edit existing zero-based array indexes. When combined, replacement runs first, then indexed edits, then appends. Use `[]` to clear the user list, or a replacement array to remove selected users. Empty strings clear optional text fields and notification targets.

Disabling a channel causes actions that reference it to skip its notifications. `--dry` previews the outgoing request; `--format json` prints the API success response.

## channel delete

Permanently delete a channel by exact ID. Explicit confirmation is required.

```sh
xy channel delete CHANNEL_ID --confirm
xy channel delete --id CHANNEL_ID --confirm
xy channel delete CHANNEL_ID --confirm --dry
```

Deletion does not remove references from events, workflows, categories, server groups, or alerts. Update those actions when replacing a channel. `--dry` previews the request without deleting anything; `--format json` prints the API success response.

## monitors

List monitor definitions in their configured sort order, including IDs, titles, display settings, data types, server groups, and modification times. Search text matches IDs, titles, source expressions, and notes.

```sh
xy monitors
xy monitors SEARCH_TEXT
xy monitors --display false
xy monitors --data_type bytes --delta true
xy monitors --group GROUP_ID_OR_TITLE
xy monitors --limit 10 --page 2
xy monitors --format json
```

Named filters can be combined. `--group` includes monitors assigned to the selected group and monitors that apply to all groups. Boolean filters include `--display`, `--delta`, and `--divide_by_delta`. `--limit`, `--page`, and `--offset` page through the table. JSON output includes all matching definitions.

## monitor

View, create, update, test, or delete a server monitor. A bare ID or fuzzy title opens its details. Updates and deletes require an exact monitor ID.

```sh
xy monitor MONITOR_ID_OR_TITLE
xy monitor get MONITOR_ID_OR_TITLE
xy monitor list
xy monitor create --title "CPU Usage" --source cpu.currentLoad --suffix %
xy monitor update MONITOR_ID --display false
xy monitor test MONITOR_ID_OR_TITLE --server SERVER_ID_OR_TITLE
xy monitor delete MONITOR_ID --confirm
```

Monitors extract numeric metrics from server data using xyOps expressions. `display` controls visibility in the web interface; hiding a monitor does not stop collection or prevent alerts from using its values.

## monitor list

List and filter monitor definitions using the same options as `xy monitors`.

```sh
xy monitor list
xy monitor list --display true --data_type float
xy monitor list --limit 10 --page 2
```

## monitor get

View a monitor's source expression, data type, regular expression, delta settings, server groups, display settings, notes, and revision metadata. Exact IDs take precedence over fuzzy titles.

```sh
xy monitor MONITOR_ID_OR_TITLE
xy monitor get --id MONITOR_ID
xy monitor get --title "CPU Usage"
xy monitor MONITOR_ID --format json
xy monitor MONITOR_ID --export monitor.json
```

## monitor create

Create a monitor with a required title and source expression. Defaults are `float` data, visible display, all server groups, no delta processing, and empty suffix, regular expression, icon, and notes. xyOps generates the ID unless you supply `--id`, and places the monitor at the end of the list.

```sh
xy monitor create --title "CPU Usage" --source cpu.currentLoad --suffix % --min_vert_scale 100
xy monitor create --id free_memory --title "Free Memory" --source memory.available --data_type bytes
xy monitor create --title "Network Bytes per Second" --source stats.network.rx_bytes --data_type bytes --delta true --divide_by_delta true --delta_min_value 0
xy monitor create --title "Process Count" --source processes.all --data_type integer --groups '["GROUP_ID"]'
xy monitor create --title "Hidden Metric" --source cpu.currentLoad --display false --notes "Used by alerts"
xy monitor create --json @monitor.json
cat monitor.json | xy monitor create --json @-
xy monitor create --title "Preview" --source cpu.currentLoad --dry
```

Supported fields are `id`, `title`, `source`, `data_type`, `data_match`, `display`, `icon`, `groups`, `suffix`, `min_vert_scale`, `delta`, `divide_by_delta`, `delta_min_value`, and `notes`.

`source` is an xyOps expression evaluated against server data. `data_type` is one of `integer`, `float`, `bytes`, `seconds`, or `milliseconds`. Optional `data_match` is a JavaScript regular expression string; its first capture group, or the whole match if there are no captures, supplies the numeric value. Use `xy monitor test` to check an expression against a server before saving it.

`--groups` accepts a JSON array, comma-separated group IDs, or `@groups.json`. Repeated `--group GROUP_ID` options append groups without duplicates. An empty array means all groups.

`--delta true` tracks changes between samples. `--divide_by_delta true` divides those changes by elapsed seconds. `--delta_min_value 0` clamps negative changes to zero; `--delta_min_value false` disables the minimum. Other numeric minimums are also accepted. `min_vert_scale` is a non-negative minimum chart range and defaults to `0`, or `1` for integer monitors. Add `--format json` to print the created monitor object.

## monitor update

Update a monitor by exact ID. Only the selected fields are sent to xyOps, preserving unrelated settings. The ID and server-managed audit fields cannot be changed.

```sh
xy monitor update MONITOR_ID --title "Production CPU" --notes "Primary load metric"
xy monitor update MONITOR_ID --source cpu.currentLoad --data_type float --suffix %
xy monitor update MONITOR_ID --display false
xy monitor update MONITOR_ID --delta true --divide_by_delta true --delta_min_value 0
xy monitor update MONITOR_ID --delta_min_value false
xy monitor update MONITOR_ID --groups '["GROUP_ID"]'
xy monitor update MONITOR_ID --group GROUP_ID --group ANOTHER_GROUP_ID
xy monitor update MONITOR_ID --groups.0 GROUP_ID
xy monitor update MONITOR_ID --groups '[]' --data_match '' --suffix ''
xy monitor update MONITOR_ID --sort_order 1
xy monitor update --id MONITOR_ID --json @changes.json
xy monitor update MONITOR_ID --display false --dry
```

The editable fields are the same as create, except `id` selects the monitor and `sort_order` can be set to an integer to change its position. Lower sort orders appear first. Supply negative numbers through a JSON file or stdin, as the command-line argument parser treats leading hyphens as options. A whole `--groups` list replaces the saved list, dotted paths edit existing indexes, and repeated `--group` options append IDs afterward. Use `--groups '[]'` to apply the monitor to all groups.

`--dry` previews the outgoing request; `--format json` prints the API success response.

## monitor test

Evaluate a saved monitor or an unsaved expression against a server's current data, without changing the monitor. Select a server by exact ID or fuzzy title, hostname, or IP address. Saved monitors support ID or fuzzy title lookup, with optional source, data type, and regular expression overrides.

```sh
xy monitor test MONITOR_ID_OR_TITLE --server SERVER_ID_OR_TITLE
xy monitor test --id MONITOR_ID --server SERVER_ID --source cpu.currentLoad
xy monitor test --server SERVER_ID_OR_TITLE --source cpu.currentLoad --data_type float
xy monitor test --server SERVER_ID --source '"42 workers"' --data_match '(\d+)' --data_type integer
xy monitor test MONITOR_ID --server SERVER_ID --data_match '' --format json
xy monitor test --server SERVER_ID --source '1 + 2' --dry
```

An unsaved expression defaults to `float`. Tests evaluate the source, apply `data_match` if set, and convert the result to the selected data type. They do not calculate changes between samples or apply delta settings. A successful zero is displayed as `0`; an expression that cannot be evaluated displays `No Value`. Invalid expression syntax or a regular expression that does not match produces an API error.

JSON output preserves the API response: `{ "code": 0, "value": 37.5 }` or `{ "code": 0, "fail": true }`. Testing requires the `edit_monitors` privilege.

## monitor delete

Permanently delete a monitor by exact ID. Explicit confirmation is required.

```sh
xy monitor delete MONITOR_ID --confirm
xy monitor delete --id MONITOR_ID --confirm
xy monitor delete MONITOR_ID --confirm --dry
```

Review any alert expressions that refer to the monitor before deleting it. `--dry` previews the request without deleting anything; `--format json` prints the API success response.

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
xy event ID_OR_TITLE --export event.json
xy event ID_OR_TITLE --export event.json --deps all
```

`xy event ID_OR_TITLE` is the short form of `xy event get ID_OR_TITLE`. See `xy help export` for XYPDF export options and dependency selection.

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

## log

Search current or archived xyOps system logs. This command requires an administrator API Key. The log name defaults to `xyOps`, and the row limit defaults to **100**.

```sh
xy log
xy log xyOps --rows 100 --format json
xy log xyOps --match "error"
xy log xyOps --match "ERROR" --case
xy log xyOps --match "error|warning" --regex
xy log xyOps --cols hires_epoch,component,category,code,msg
xy log xyOps --cols '["msg","data"]' --format json
xy log xyOps --date 2026-09-04 --rows 100
xy log xyOps --sort date_desc
xy log --log xyOps --match "timeout" --dry
```

| Option | Description |
| --- | --- |
| `--rows N` | Return the last N matching rows, from 1 to 1000. Defaults to 100. |
| `--match TEXT` | Search complete log lines for literal text. Omit to match all rows. |
| `--regex` | Interpret `--match` as a regular expression. |
| `--case` | Match case sensitively. Searches are case insensitive by default. |
| `--cols LIST` | Select columns using comma-separated names or a JSON array. |
| `--date YYYY-MM-DD` | Search the archive for a day in the server's time zone. Omit to search the current live log. |
| `--sort date_asc` | Show the returned rows in file order, oldest first (the default). |
| `--sort date_desc` | Reverse the returned rows to show newest first. |
| `--format json` | Print the matching row objects as a JSON array. |

Specify the log's base filename without its extension, such as `xyOps`. Standard column IDs are `hires_epoch`, `date`, `hostname`, `pid`, `component`, `category`, `code`, `msg`, and `data`; available columns follow your server configuration.

Default output reconstructs native bracket-delimited log lines using all columns in the server's configured order. Brackets are gray and column values are color-coded, with full messages and data preserved. JSON output also defaults to all API columns and preserves their values, including the `data` field as a string. An explicit `--cols` selection applies to either output format. Column selection does not restrict which parts of each log line are searched.

The API retains the last N matches, then the CLI applies display order. `--sort date_asc` does not select the earliest N matches. There is no numbered pagination, so use `--rows` rather than `--limit`, `--offset`, or `--page`. The summary's total log-row count includes non-matching lines; it is not a total match count.

Missing logs or archives return an empty result. `--dry` previews the API request without searching. To view a particular job's output instead, use `xy job log JOB_ID`.
