# help

Welcome to the xyOps command-line interface. Use `xy` to check your system at a glance, then explore events and jobs with friendly commands designed for both people and scripts.

```sh
xy
xy system
xy events
xy jobs
xy keys
xy alerts
xy buckets
xy categories
xy channels
xy doc
xy log xyOps --rows 100
xy monitors
xy plugins
xy servers
xy snapshots
xy groups
xy secrets
xy tags
xy tickets
xy hooks
xy marketplace
xy event EVENT_ID --export event.json
xy import event.json
xy sync ./ --up events,plugins --dry
```

Use plural commands such as `events`, `jobs`, and `tickets` to browse collections, and singular commands such as `event`, `job`, and `ticket` to work with one item. Names and titles are matched fuzzily wherever `ID_OR_TITLE` is shown. You can use the `help` system to get details for each command:

```sh
xy help events
xy help system
xy help system export
xy help system diagnostic
xy help system restart
xy help system shutdown
xy help doc
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
xy help plugins
xy help plugin
xy help plugin create
xy help servers
xy help server
xy help server add
xy help server search
xy help snapshots
xy help snapshot
xy help groups
xy help group
xy help group history
xy help group create
xy help secrets
xy help secret
xy help secret create
xy help secret decrypt
xy help tags
xy help tag
xy help tag create
xy help tickets
xy help ticket
xy help ticket create
xy help ticket comment
xy help hooks
xy help hook
xy help hook create
xy help hook test
xy help marketplace
xy help marketplace search
xy help marketplace get
xy help marketplace install
xy help export
xy help import
xy help sync
xy help sync setup
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
| Web hook | `xy hook WEB_HOOK_ID --export hook.json` |

Use `--export` with a single object's detail command rather than a list, search, or mutation command. `--id` and `--title` selectors are also supported.

Files are pretty-printed JSON. A `.gz` suffix enables gzip compression; use `.json.gz` for compatibility with the web interface. The destination directory must exist. Existing files are preserved unless you pass `--overwrite`. `--dry` shows what would be written without creating a file. `--format json` prints the output path, item count, and any dependency warnings.

Exports contain reusable definitions rather than history and audit details. Buckets do not include stored JSON data or uploaded files, API Key exports never reveal the plaintext secret, and Alert exports contain definitions rather than active alert invocations.

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

These choices match the web interface. Stock event and job Plugins are omitted. Only the selected dependency types are included, shared dependencies appear once, and linked workflows are followed safely. Missing dependencies are reported as warnings and omitted from the file.

## import

Read a plain JSON or gzip-compressed XYPDF file and preview its contents and planned changes. **No changes are made until you add `--confirm`.** Review the complete data, including Plugin scripts and event triggers, before importing files from another source.

```sh
xy import event.json
xy import workflow.json.gz
xy import workflow.json.gz --format json
xy import workflow.json.gz --dry
```

The file determines the object types and may contain any combination of the 12 types supported by `xy help export`. Before making changes, the preview checks the file format, required xyOps version, object types, titles, IDs, and duplicate IDs.

An exact matching ID updates the existing object; otherwise a new object is created. Missing or empty IDs are generated by xyOps. Titles are not used to select updates. Omitted fields remain unchanged, while included arrays replace their existing values.

Dependencies are imported before the objects that use them. Circular dependencies among new objects are rejected during preview, while references to existing definitions are allowed. Importing a Bucket never writes or clears its stored data or files. Restoring an API Key requires a compatible xyOps version and never reveals its plaintext secret.

The preview identifies updates and events with active triggers. Confirmed imports preserve the settings in the file, so enabled schedules or other triggers can run automatically afterward. `--dry` always previews, even with `--confirm`.

Your configured permissions still apply during import. If an item fails, import stops and reports each item as `created`, `updated`, `failed`, or `pending`. Earlier successful changes remain in place; there is no automatic rollback. JSON output includes these results, and failed imports exit with a nonzero status.

## sync

For setup, configuration, file layouts, and automation examples, see the dedicated [Filesystem Sync Guide](sync.md).

Sync existing xyOps definitions with a directory of XYPDF files. Each run scans the directory and its subdirectories, shows any differences, and applies changes in the directions you select. **Changes are applied immediately unless you add `--dry`; there is no `--confirm` step.**

```sh
xy sync ./ --up events,plugins --dry
xy sync ./ --up events,plugins
xy sync ./ --down events,plugins --dry
xy sync ./ --down events,plugins
xy sync ./ --up categories,plugins --down events --dry
xy sync ./ --up events --down events --dry
xy sync ./ --up all --dry
xy sync --up events,plugins --verbose
```

Pass one or more base directories, or omit them to scan the current directory. Folder layout and filenames are up to you. Use `xy help sync setup` to export a starter tree.

**Directions and resource types**

- `--up TYPES` updates xyOps from local files.
- `--down TYPES` updates local files from xyOps.
- `--dry` previews changes without applying them.
- `--verbose` shows full diffs and API requests and responses.

You must enable at least one direction. `TYPES` is a comma-separated list of `alerts`, `api_keys`, `categories`, `channels`, `events`, `groups`, `monitors`, `plugins`, `tags`, or `web_hooks`. Use `all` to select every supported type. Workflows are included under `events`. Buckets, Secrets, Users, and Roles are not supported.

Enable both directions for the same type to use experimental two-way sync. The newest modification time wins, including external property files. Git checkouts can reset filesystem timestamps, so prefer one-way sync when reliable conflict handling matters. Dry runs never update xyOps, write files, run completion commands, or send notifications.

Sources must be plain `.json` XYPDF files containing exactly one item each. Objects are matched by type and exact ID, not by title. Sync does not create new xyOps objects or local files for newly added objects. Use setup or individual exports to add local sources, and keep their original IDs.

Repeated sources with the same type and ID generate warnings, even if their contents are identical. Later duplicates are skipped during scanning, and the warnings stop the run before any definition, file, tracking, or deletion changes. Keep one source per object and avoid overlapping base directories. Warning notifications can still run; warnings produce exit status `1`.

External string properties are loaded automatically from adjacent files named `BASENAME-PROPERTY.EXT`, such as `My-Plugin-script.js` beside `My-Plugin.json`, or `My-Event-params.script.sh` beside `My-Event.json`. The extension is your choice. Keep only one external file per property, and rename its basename along with the JSON file.

**Delete mode**

Add `--delete TYPES` to delete xyOps objects that have no matching source in the scanned directories. Deletion requires up-only sync and a complete local inventory. The CLI rejects deletion if upsync is disabled or any downsync direction is enabled, including saved defaults and dry runs. Use `--down false` to disable inherited downsync. See [Delete mode](sync.md#delete-mode) before using it.

```sh
xy sync ./ --up events,plugins --delete events --dry
xy sync ./ --up events,plugins --delete events
```

**Objects with a `stock` or `marketplace` property are always ignored by deletion**, including during dry runs. They do not need local source files, and setup inclusion flags cannot override this protection.

**The scanned directories must contain a complete inventory of the other objects you intend to keep for every type selected for deletion.** Delete mode is not limited to previously synced objects. A missing file, incomplete export, or unavailable mount can cause unintended deletions of your own definitions. Verify that all source directories are available and inspect a dry run before removing `--dry`. Source warnings or scan errors stop the run before any updates begin. If an update or sync-tracking API operation fails, earlier successful updates remain in place, but the entire delete pass is skipped for that run.

**Completion commands and notifications**

```sh
xy sync ./ --down events,plugins \
	--down_cmd "git add . && git commit -m 'Sync from xyOps'"
xy sync ./ --up events,plugins \
	--error_email ops@example.com --error_event EVENT_ID
```

- `--up_cmd COMMAND` runs after successful updates to xyOps.
- `--down_cmd COMMAND` runs after successful updates to local files.
- `--cmd_timeout SECONDS` limits each command, defaulting to 30 seconds.
- `--error_email ADDRESS` sends warnings and errors by email through xyOps.
- `--error_event EVENT_ID` runs an Event on warnings or errors.

Completion commands run in a local shell in the first base directory. Deletions alone do not trigger them. Event notifications receive `input.data.errors` and `input.data.warnings`.

The configured API Key needs the appropriate resource permissions and `update_state` for sync tracking updates. Notification actions also need their usual permissions. Earlier successful changes are not rolled back if a later operation fails. Retry the sync after correcting an error; previously applied updates compare equal, and deletion remains disabled until the pre-delete phase completes without warnings or errors.

Sync warnings and errors exit with status `1`, including warnings or errors during dry runs and completion-command errors. Completion commands and notifications can finish before the process exits. Runs with no warnings or errors exit with status `0`. Scan warnings stop the run before updates and can trigger notifications.

Every sync and setup command uses a built-in host-local PID lock keyed by `base_url`. An overlapping invocation exits nonzero before doing work, while a dead process's stale lock is replaced automatically. Use `sync.lock_file` or `--lock_file PATH` to set an explicit path, particularly for a service account. The parent directory must already exist and be writable. Use one common path for local accounts targeting the same instance; PID locks do not coordinate separate hosts.

**Saved defaults**

Put sync defaults under a `sync` object in `/etc/xyops/cli.json` or `~/.config/xyops/cli.json`:

```json
{
	"sync": {
		"up": ["events", "plugins"],
		"down": false,
		"delete": false,
		"lock_file": "/run/xyops/xycli-sync.pid",
		"error_email": "ops@example.com"
	}
}
```

Command-line options override saved sync settings. Use `--up false`, `--down false`, or `--delete false` to disable a saved mode. Positional directories take precedence over `base_dirs`. Without positional directories, sync uses the configured `base_dirs` JSON array, or the current directory if it is not configured. Use `--base_dirs '["./"]'` to override the saved array for one run; positional directories still take precedence. These defaults apply to sync runs, not setup.

## sync setup

Export existing xyOps definitions into a starter sync tree in the current directory. Use a fresh directory so the generated files are easy to review before your first sync.

```sh
xy sync setup events plugins categories --dry
xy sync setup events plugins categories --file_props script,params.script
xy sync setup events --file_props params.script --default_ext ps1
xy sync setup events plugins --new
xy sync setup events --new --down_cmd "./commit-downloads.sh"
xy sync setup all
xy sync setup all --stock --marketplace
xy sync setup events plugins --force
xy sync --setup events,plugins --file_props script,params.script
```

Choose one or more resource types separated by spaces, or use `all`. Supported types are the same as for `xy sync`. The `--setup TYPES` form also accepts a comma-separated list.

Setup creates one folder per resource type and one XYPDF JSON file per object, using its title as a filename slug. Selecting `events` exports both Events and workflows, with workflows placed in a separate `workflows` folder. Events and workflows are grouped into subfolders using their Category title as a slug. Both are synced with `--up events` or `--down events`. Setup stops before writing if an Event or workflow selected for export refers to a missing Category.

- `--file_props PATHS` extracts string properties into adjacent files.
- `--default_ext EXT` sets the fallback neighbor extension instead of `txt`.
- `--new` writes only remote definitions not already represented locally.
- `--down_cmd COMMAND` runs after setup writes one or more definitions.
- `--cmd_timeout SECONDS` changes the command timeout from 30 seconds.
- `--stock` includes stock objects, which are omitted by default.
- `--marketplace` includes Marketplace objects, which are omitted by default.
- `--force` allows generated files to overwrite existing destinations.
- `--dry` previews the layout without creating directories or writing files.

For `--file_props`, use comma-separated property names or dot paths, such as `script,params.script`. Only nonempty string values are extracted. The JSON value becomes `(External)`, and sync loads the external file automatically. Setup chooses extensions from executable commands, shebangs, and JSON content when possible. Use `--default_ext ps1` (or `--default_ext .ps1`) to replace the `.txt` fallback for properties whose type cannot be detected. The override does not replace an extension that setup successfully detects.

Use `--new` from the root of an existing sync tree to add definitions that exist in xyOps but have no local source. Setup scans recursively and matches existing sources by item type and exact ID, so renamed files and custom folder layouts are preserved. New definitions use the normal suggested type and Category folders. Malformed, duplicate, unsupported, or orphaned local sources stop the operation before any new files are written. `--new` cannot be combined with `--force`, and it does not create new definitions in xyOps.

An explicitly supplied `--down_cmd` runs from the current setup directory after at least one definition is written. It does not run when `--new` finds nothing or during a dry run. Saved sync completion commands are not inherited by setup.

Without `--force`, ordinary setup stops when an output file already exists. Files written before an error are not rolled back. Ensure object titles produce distinct filename slugs, especially when using `--force`, and back up any local edits before rerunning setup. For a delete-mode inventory, verify that every object eligible for deletion that you intend to keep has a source file. Stock and Marketplace objects are protected from deletion and may be omitted.

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

Updates load the user file separately and apply only the settings specified on the command line, preserving other user settings. System settings and environment overrides are not copied into the file. If the user file does not exist, it is created with only the supplied settings.

Configuration loads `/etc/xyops/cli.json` first, then `~/.config/xyops/cli.json`, then `XYOPS_`-prefixed environment variables. Later sources override matching top-level settings. Environment overrides still take precedence over saved user settings. Common keys include `api_key`, `base_url`, `temp_dir`, `color`, `suggest`, `items_per_page`, `cache_ttl`, `raw`, and `invisible`.

## doc

Fetch and display xyOps documentation in the terminal. Run the command without a document name to browse the documentation index. Specify a document to read it in full, or add a chapter slug to focus on one section and all of its sub-sections.

```sh
xy doc
xy doc plugins
xy doc plugins/output-data
xy doc plugins output-data
```

Chapter slugs are lowercase heading names with punctuation and spaces replaced by hyphens. The slash and space forms are equivalent. Internal documentation links are displayed as copyable `xy doc` commands.

## dashboard

Show the main xyOps dashboard, including server health, active alerts and jobs, queued work, and active rate limits. Add the upcoming view when you also want to see jobs expected to run soon.

```sh
xy
xy dashboard
xy dashboard --upcoming
xy dashboard upcoming
xy upcoming
```

## system

Show the administrator System dashboard. It includes process and database statistics, internal jobs, conductor status, and all connected users.

System commands require a full administrator API Key.

```sh
xy system
xy system dashboard
xy system export xyops-export.json.gz
xy system import xyops-export.json.gz
xy system delete events,categories,buckets
xy system maintenance
xy system optimize
xy system reset rates
xy system reset sync
xy system restart conductor xyops02.example.com
xy system shutdown conductor xyops02.example.com
xy system upgrade workers server1,server2
xy system email test@example.com
xy system diagnostic
xy system broadcast "System maintenance begins soon"
```

Several System operations can interrupt jobs or permanently change data. Commands that import, delete, restart, shut down, upgrade, or reset sync state require `--confirm` before they proceed.

## system export

Download a gzip-compressed xyOps data archive. By default, all configuration lists are included, while database history and optional file data are omitted.

```sh
xy system export xyops-export.json.gz
xy system export config.json.gz --lists events,categories,plugins
xy system export history.json.gz --lists none --indexes jobs,activity
xy system export complete.json.gz --lists all --indexes all --extras all
xy system export xyops-export.json.gz --overwrite
xy system export xyops-export.json.gz --dry
```

Use `--lists`, `--indexes` (or `--tables`), and `--extras` with comma-separated names. Each option also accepts `all` or `none`.

Configuration lists include `alerts`, `api_keys`, `buckets`, `categories`, `channels`, `events`, `groups`, `monitors`, `plugins`, `secrets`, `tags`, `users`, `roles`, and `web_hooks`. Database indexes include `alerts`, `jobs`, `servers`, `snapshots`, `activity`, and `tickets`. Extras include job files and logs, Bucket files, Ticket files, Monitor history, statistics history, and user avatars.

The destination directory must already exist. Existing files are preserved unless you add `--overwrite`. The completed archive is written with permissions limited to your user account.

## system import

Import an xyOps or Cronicle bulk data archive. The command shows the selected file and its format first. **No data is imported until you add `--confirm`.**

```sh
xy system import xyops-export.json.gz
xy system import cronicle-export.txt.gz --source cronicle
xy system import xyops-export.json.gz --dry
```

Bulk imports can replace existing data, stop running jobs, clear queued jobs, and pause the scheduler. Back up your system and review the selected file before confirming.

## system delete

Permanently delete selected categories of system data. Pass a comma-separated list, or use `all` to select everything. **Nothing is deleted until you add `--confirm`.**

```sh
xy system delete events,categories,buckets
xy system delete jobs,activity
xy system delete all
```

Names normally select the matching configuration list or database index. `alerts` selects both Alert definitions and Alert history. Use an explicit `list:` or `db:` prefix when you only want one, such as `list:alerts` or `db:alerts`.

Bulk deletion may pause the scheduler. This operation cannot be undone, so export a backup first.

## system maintenance

Run the normal nightly maintenance process immediately. Expired data is removed, and a database backup is created when backups are configured. The work continues as an internal background job.

```sh
xy system maintenance
xy system maint
xy system maintenance --dry
```

## system optimize

Compact the database to reclaim unused disk space and run an integrity check. The database may be locked while this work runs, so stop active jobs and pause the scheduler first. Results are sent to the administrator by email when email is configured.

```sh
xy system optimize
xy system optimize --dry
```

## system reset

Reset daily dashboard statistics, job rate-limit windows, or the global sync state map. You can reset one rate-limit pool by ID, or omit `--id` to reset every pool.

```sh
xy system reset daily
xy system reset rates
xy system reset rates --id RATE_POOL_ID
xy system reset rates --dry
xy system reset sync
xy system reset sync --dry
```

Resetting rate limits immediately restores their full allowance, so queued jobs may begin launching on the next scheduler tick.

Resetting sync state clears every remote-management flag. It does not change any xyOps definition, local file, or saved sync configuration. The web interface and CLI stop showing their sync-management edit warnings until a later up-only sync publishes a new map. The command displays the target and makes no change until you add `--confirm`.

## system restart

Restart a conductor server by hostname. The command shows the selected hostname first. **The restart request is not sent until you add `--confirm`.**

```sh
xy system restart conductor xyops02.example.com
```

Restarting a conductor may briefly interrupt service while the process starts again.

## system shutdown

Shut down a conductor server by hostname. The command shows the selected hostname first. **The shutdown request is not sent until you add `--confirm`.**

```sh
xy system shutdown conductor xyops02.example.com
```

The conductor remains offline until it is started again outside the CLI.

## system upgrade

Upgrade or downgrade selected worker or conductor servers. Worker targets may be server IDs or group IDs. Conductor targets are host IDs.

```sh
xy system upgrade conductors joemax.lan --version v1.0.96
xy system upgrade workers server1,server2
xy system upgrade workers GROUP_ID --version latest --stagger 30
```

The default version is `latest`, and the default delay between servers is 60 seconds. Use `--stagger SECONDS` to change the delay. Review the target summary, then add `--confirm` to start the upgrade.

## system email

Send a test email and show the delivery result and mailer log. Use this to verify the xyOps email configuration.

```sh
xy system email test@example.com
xy system email --to test@example.com
xy system email test@example.com --dry
```

## system diagnostic

Print a detailed System diagnostic snapshot as JSON. The snapshot includes system and storage statistics, conductors, workers, active work, scheduler state, and connections.

```sh
xy system diagnostic
xy system diag
xy system diagnostic --format jsonc
```

Diagnostic output can contain hostnames, IP addresses, usernames, job parameters, and other private system details. Review it carefully before sharing it.

## system broadcast

Send a plain-text notification to every connected xyOps user. The default notification type is `info`.

```sh
xy system broadcast "System maintenance begins soon"
xy system broadcast "Please save your work" --type warning
xy system broadcast --message "All systems are operational" --type info
xy system broadcast "Deployment complete" --sound bell.mp3
xy system broadcast "Test message" --dry
```

Available notification types are `info`, `warning`, `error`, and `critical`. Use `--sound FILENAME` to play a sound that is already available in xyOps.

## snapshots

List saved Server and Group snapshots, newest first. Use the optional indexed filters to narrow the history by source, exact Server ID, or exact Group ID.

```sh
xy snapshots
xy snapshots --source user
xy snapshots --server SERVER_ID
xy snapshots --group GROUP_ID
xy snapshots --limit 20 --page 2
xy snapshots --format json
```

Snapshot sources are `alert`, `user`, `watch`, and `job`. Filters may be combined. Free-form keyword search and custom date ranges are not supported by this command.

## snapshot

View one saved Server or Group snapshot by its exact ID. The CLI detects the snapshot type and displays the matching point-in-time view automatically.

```sh
xy snapshot SNAPSHOT_ID
xy snapshot SNAPSHOT_ID --monitors
xy snapshot SNAPSHOT_ID --processes
xy snapshot SNAPSHOT_ID --connections
xy snapshot SNAPSHOT_ID --verbose
xy snapshot SNAPSHOT_ID --delete
```

The default view includes the captured summary, Alerts, Jobs, Quick Look charts, memory and CPU details, monitor summary, Containers, network interfaces, and filesystems when available. Group snapshots also include the captured Server table.

Add `--monitors` to fetch and chart the 60 one-minute historical samples ending at the snapshot. The snapshot minute is the final sample on the right side of each chart. Add `--processes` or `--connections` for the larger captured tables, or use `--verbose` to include all optional sections.

Deletion first displays the selected snapshot and makes no change until you add `--confirm`. Snapshot deletion cannot be undone.

## servers

List connected Servers and recently disconnected Servers in one view. Results are sorted alphabetically by custom label or hostname.

Add search text to match Server IDs, labels, hostnames, IP addresses, operating systems, CPU details, xySat versions, or Server Groups. Named filters use case-insensitive partial matching, so a partial IP address is accepted here.

```sh
xy servers
xy servers SEARCH_TEXT
xy servers --os linux
xy servers --ip 192.168.1.
xy servers --group production
xy servers --online true
xy servers --limit 20 --page 2
```

Available named filters include `--id`, `--title`, `--hostname`, `--ip`, `--os`, `--platform`, `--distro`, `--release`, `--arch`, `--cpu`, `--satellite`, `--group`, `--status`, `--online`, and `--enabled`.

## server

View a Server's live or last-known state, generate an installation command for a new Server, or search current and historical Server records.

```sh
xy server SERVER_ID
xy server SERVER_ID --verbose
xy server list
xy server add --platform linux
xy server search
xy server search SEARCH_TEXT
xy server history SERVER_ID YYYY/MM/DD
xy server SERVER_ID --label "My Custom Label"
xy server SERVER_ID --snapshot
xy server SERVER_ID --watch 300
xy server SERVER_ID --delete
```

## server get

View the current state of a connected Server, or the last-known state of an offline Server. You can identify the Server by ID, hostname, or label when it is connected or recently disconnected. The summary includes system information, alerts, jobs, monitoring charts, memory, CPU, network interfaces, and filesystems.

Use the optional detail flags to show larger tables and monitoring timelines:

```sh
xy server SERVER_ID
xy server minecraft2
xy server render-worker-03
xy server get SERVER_ID
xy server SERVER_ID --verbose
xy server SERVER_ID --monitors
xy server SERVER_ID --processes
xy server SERVER_ID --connections
xy server SERVER_ID --pid 1234
xy server SERVER_ID --limit 20 --page 2
```

The `--pid` option opens a focused process view containing only the selected process details and its parent and child processes. Use `--verbose` to include monitors, processes, and network connections together in the main Server view.

Quick Look charts are available for connected Servers that support per-second monitoring. Offline Servers display their last-known monitoring state instead.

## server history

View historical monitoring charts, alerts, and completed jobs for one Server. Each command displays exactly one hour, day, month, or year. Dates and times are interpreted in the Server's local time zone.

```sh
xy server history SERVER_ID 2026/09/08/14
xy server history SERVER_ID 2026/09/08
xy server history SERVER_ID 2026/09
xy server history SERVER_ID 2026
xy server history SERVER_ID 2026/09/08 --limit 20 --page 2
```

The number of date components selects the zoom level. Use `YYYY/MM/DD/HH` for an hour, `YYYY/MM/DD` for a day, `YYYY/MM` for a month, or `YYYY` for a year.

You can use a hostname or Server label in place of the ID when that Server is connected or recently disconnected. The global `--page` and `--limit` options apply to both the alert and completed-job tables.

## server add

Generate a one-line xySat installation command for Linux, macOS, Windows, or Docker. Copy the resulting command and run it on the Server you want to add.

```sh
xy server add --platform linux
xy server add --platform windows --title "My Custom Server"
xy server add --platform macos --icon fire-truck
xy server add --platform docker --groups GROUP1,GROUP2
xy server add --platform linux --enabled false
xy server add --platform linux --expires 3600
```

The installation token is valid for 24 hours by default. Use `--expires SECONDS` to choose a shorter lifetime. Treat the generated command as sensitive until its token expires.

If you specify Server Groups, each value must be an existing Group ID. Leave `--groups` unset to use automatic hostname-based grouping.

## server search

Search all current and historical Server records. Unlike the active `servers` view, this searches the database and requires complete indexed terms such as a full IP address.

Both singular and plural command forms are supported:

```sh
xy server search
xy servers search
xy server search SEARCH_TEXT
xy server search "192.168.1.25"
xy server search --os_platform linux --os_arch arm64
xy server search --groups GROUP_ID
xy server search --modified today
xy server search --limit 20 --page 2
```

Available fields include `--groups`, `--os_platform`, `--os_distro`, `--os_release`, `--os_arch`, `--cpu_virt`, `--cpu_brand`, `--cpu_cores`, `--created`, and `--modified`. Short aliases such as `--group`, `--os`, `--platform`, `--distro`, `--release`, `--arch`, `--virt`, and `--cpu` are also accepted.

## server commands

Edit a Server, take a snapshot, set a temporary snapshot watch, or permanently delete it. You can identify a connected or recently disconnected Server by ID, hostname, or label.

```sh
xy server SERVER_ID --label "My Custom Label"
xy server SERVER_ID --enabled false
xy server SERVER_ID --icon baguette
xy server SERVER_ID --groups "group1,group2"
xy server SERVER_ID --groups ""
xy server SERVER_ID --max_jobs 5
xy server SERVER_ID --user_data '{"foo":"bar"}'
xy server SERVER_ID --user_data @server-data.json
xy server SERVER_ID --snapshot
xy server SERVER_ID --watch 300
xy server SERVER_ID --watch 0
xy server SERVER_ID --delete
```

An empty `--groups` value restores automatic hostname-based grouping. Snapshot and watch commands require a connected Server. A watch takes one snapshot per minute for the requested number of seconds, and `--watch 0` removes it.

Server deletion always removes the Server record, all monitoring history, and all snapshots. If the Server is connected, xySat is also uninstalled. The command shows a detailed preview first and does nothing until you add `--confirm`.

## groups

List Server Groups in their saved order. The table includes each Group's ID, title, connected Server count, hostname pattern, Alert Action count, author, and modification time. Search text matches IDs, titles, hostname patterns, and notes. Named filters may also be combined.

```sh
xy groups
xy groups SEARCH_TEXT
xy groups --title Production
xy groups --hostname_match "^db"
xy groups --limit 10 --page 2
xy groups --format json
```

The Server count includes currently connected Servers. Recently offline Servers may appear in a Group's detail view, but are not included in this count.

## group

View, create, update, or delete a Server Group. A bare ID or fuzzy title opens the combined live monitoring view. Updates and deletes require an exact Group ID.

```sh
xy group GROUP_ID_OR_TITLE
xy group get GROUP_ID_OR_TITLE
xy group list
xy group create --title "Production DBs" --hostname_match "db\\d+\\.prod\\."
xy group update GROUP_ID --icon baguette
xy group delete GROUP_ID
xy group history GROUP_ID YYYY/MM/DD
```

## group list

List and filter Server Groups. This is an alias for `xy groups`, with the same options.

```sh
xy group list
xy group list SEARCH_TEXT
xy group list --limit 10 --page 2
```

## group get

Show the combined live or recently offline state for all selected Servers in a Group. The view includes the Group summary, Server table, active Alerts and Jobs, Quick Look charts, memory and CPU details, Containers, and optional Monitor, Process, and connection sections.

```sh
xy group GROUP_ID
xy group GROUP_ID --verbose
xy group GROUP_ID --monitors
xy group GROUP_ID --processes
xy group GROUP_ID --connections
xy group GROUP_ID --merge total
xy group GROUP_ID --merge max
xy group GROUP_ID --limit 20 --page 2
```

Chart and detail values default to `--merge average`. The accepted modes are `average` (or `avg`), `maximum` (or `max`), `minimum` (or `min`), and `total`. The selected merge mode is included in each chart title.

Use `--verbose` to show Monitors, Processes, and network connections together, or enable those sections individually. Containers are always shown when available. Process and Container actions are intentionally read-only in the Group view.

You can limit the live view to matching Servers:

```sh
xy group GROUP_ID SEARCH_TEXT
xy group GROUP_ID --os linux
xy group GROUP_ID --ip 192.168.
xy group GROUP_ID --arch arm64
xy group GROUP_ID --online true
```

Search text checks Server IDs, labels, hostnames, IP addresses, operating system details, CPU details, xySat versions, and Group names. Named filters use the same case-insensitive partial matching as `xy servers`.

Add `--upcoming` to show only the Group summary and predicted upcoming Jobs:

```sh
xy group GROUP_ID --upcoming
xy group GROUP_ID --upcoming --limit 20 --page 2
```

## group history

View merged historical Monitor charts, Alerts, and completed Jobs for a Server Group. The view includes Servers that belonged to the Group during the selected period.

```sh
xy group history GROUP_ID 2026/09/09/14
xy group history GROUP_ID 2026/09/09
xy group history GROUP_ID 2026/09
xy group history GROUP_ID 2026
xy group history GROUP_ID 2026/09/09 --merge maximum
xy group history GROUP_ID 2026/09/09 --limit 20 --page 2
```

The number of date components selects exactly one hour, day, month, or year. Dates and times use the xyOps Server's local time zone. Server filters such as `--os` and `--ip` apply only to live Group views.

The `--merge` modes are the same as the live view, and historical Monitor charts are always shown. Pagination applies to the Server, Alert, and completed Job tables.

## group create

Create a Server Group with a required title. The hostname pattern defaults to a regular expression that matches no Servers when omitted. xyOps generates an ID unless you provide one.

```sh
xy group create --title "Production DBs" --hostname_match "db\\d+\\.prod\\."
xy group create --id production --title "Production" --hostname_match ".+"
xy group create --title "Manual Group" --icon server-network
xy group create --title "Limited Workers" --max_jobs_per_server 4
xy group create --title "Notifications" --action '{ "type":"web_hook", "enabled":true, "condition":"alert_new", "web_hook":"example_hook" }'
xy group create --json @group.json
xy group create --title "Preview" --dry
```

Supported fields are `id`, `title`, `hostname_match`, `icon`, `notes`, `max_jobs_per_server`, and `alert_actions`. The singular `--action` option appends one Alert Action and may be repeated. Use `--alert_actions` to provide a complete JSON array.

`max_jobs_per_server` sets the default concurrent Job limit for each Server in the Group. Zero means unlimited. Individual Server settings may override it.

## group update

Update a Server Group by exact ID. Omitted fields remain unchanged. Use `--alert_actions` to replace the complete Alert Action list, dotted options to edit existing Actions, or `--action` to append a new one.

```sh
xy group update GROUP_ID --title "New Title" --notes "Updated notes"
xy group update GROUP_ID --hostname_match "^prod-db-"
xy group update GROUP_ID --icon baguette --max_jobs_per_server 8
xy group update GROUP_ID --alert_actions.0.enabled false
xy group update GROUP_ID --action @action.json
xy group update GROUP_ID --alert_actions '[]'
xy group update GROUP_ID --json @group-update.json
xy group update GROUP_ID --notes "Preview" --dry
```

An empty `hostname_match` matches no Servers. Invalid regular expressions are rejected without changing the Group. The Group ID cannot be changed.

## group delete

Permanently delete a Server Group by exact ID. The command shows the selected Group and does nothing until you add `--confirm`.

```sh
xy group delete GROUP_ID
xy group delete --id GROUP_ID
xy group delete GROUP_ID --dry
```

Deleting a Group changes Server membership and may affect Event targets, Monitor scopes, Alert definitions, and other saved configuration. Review those references before confirming.

## upcoming

Show the main dashboard with the upcoming-jobs section included. This is a convenient shortcut for `xy dashboard --upcoming`.

```sh
xy upcoming
xy dashboard --upcoming
```

## alerts

List Alert definitions, or search Alert invocations when the next word is `search`.

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

Other named options may be used for additional searchable fields.

## alert

Work with alert definitions and alert invocations through one short command. Operations that create, update, or test always target definitions. Search always targets invocations.

```sh
xy alert ID_OR_TITLE
xy alert get ID_OR_TITLE
xy alert create --title "My Alert" --expression "cpu.currentLoad > 80" --message "CPU is high"
xy alert update DEFINITION_ID --enabled false
xy alert test DEFINITION_ID --server SERVER_ID_OR_TITLE
xy alert delete ALERT_ID
```

Get and delete can refer to either resource type. Use an exact Alert ID for an invocation, or an exact definition ID or fuzzy definition title for a definition.

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

Dotted options preserve other nested values. Repeat `--delete PATH` to remove nested object properties. Paths are strict, so missing properties and attempts to delete array elements are rejected.

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
xy alert delete DEFINITION_ID
xy alert delete INVOCATION_ID
xy alert delete ALERT_ID --dry
```

Deleting an invocation removes only that historical record. Deleting a definition also removes its current state and invocation history.

## buckets

List storage Bucket definitions and their metadata. Use `bucket get` to view a Bucket's JSON data and files.

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
xy bucket file delete BUCKET_ID report.csv
xy bucket empty BUCKET_ID --data --files
xy bucket delete BUCKET_ID
```

Bucket metadata, JSON data, and files have separate commands. Use `bucket update` for metadata, `bucket write` for JSON data, and the file commands for attachments.

## bucket get

View a bucket definition together with all current JSON data and file metadata. The file list includes complete File IDs and normalized filenames.

```sh
xy bucket BUCKET_ID_OR_TITLE
xy bucket get BUCKET_ID_OR_TITLE
xy bucket get BUCKET_ID --format json
xy bucket BUCKET_ID --export bucket.json
```

JSON output contains `bucket`, `data`, and `files`. The `--export` variant writes only the Bucket definition to XYPDF; see `xy help export`.

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

## bucket update

Update bucket metadata using the exact internal Bucket ID.

```sh
xy bucket update BUCKET_ID --title "Release Artifacts"
xy bucket update BUCKET_ID --enabled false
xy bucket update BUCKET_ID --icon archive --notes "Production releases"
xy bucket update BUCKET_ID --notes "Preview" --dry
```

This command only accepts `title`, `enabled`, `icon`, and `notes`. Use `bucket write` for JSON data and the file commands for file contents.

## bucket write

Merge a JSON object into a Bucket's existing data. The exact internal Bucket ID is required.

```sh
xy bucket write BUCKET_ID --data.status ready --data.build 42
xy bucket write BUCKET_ID --data @data.json
cat data.json | xy bucket write BUCKET_ID --data @-
xy bucket write BUCKET_ID --json @request.json
cat request.json | xy bucket write BUCKET_ID --json @-
xy bucket write BUCKET_ID --data @data.json --format json
```

`--data @-` treats the piped object as the Bucket data itself. The `--json` forms expect an object containing a `data` property. This is a shallow merge, so existing top-level keys not present in the input are preserved.

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
xy bucket file delete BUCKET_ID report.csv
xy bucket file delete BUCKET_ID FILE_ID
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
xy bucket file delete BUCKET_ID report.csv
xy bucket file delete BUCKET_ID FILE_ID
xy bucket file delete BUCKET_ID report.csv --dry
```

## bucket empty

Permanently clear all data, all files, or both while keeping the bucket definition. Explicit confirmation is required.

```sh
xy bucket empty BUCKET_ID --data
xy bucket empty BUCKET_ID --files
xy bucket empty BUCKET_ID --data --files
xy bucket empty BUCKET_ID --all
xy bucket empty BUCKET_ID --all --dry
```

## bucket delete

Permanently delete a bucket definition together with all of its data and files. The exact internal Bucket ID and explicit confirmation are required.

```sh
xy bucket delete BUCKET_ID
xy bucket delete BUCKET_ID --dry
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
xy key delete KEY_ID
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
xy key delete KEY_ID
xy key delete KEY_ID --dry
```

Deletion cannot be undone. Any service using the deleted key immediately loses access.

## secrets

List Secret Vault metadata without decrypting any variable values. Search text matches vault IDs, titles, notes, and variable names. Named filters may be combined.

```sh
xy secrets
xy secrets SEARCH_TEXT
xy secrets --enabled false
xy secrets --name API_TOKEN
xy secrets --event EVENT_ID
xy secrets --category CATEGORY_ID --plugin PLUGIN_ID
xy secrets --hook WEB_HOOK_ID
xy secrets --limit 10 --page 2
xy secrets --format json
```

The list includes variable names and assignment counts, but never encrypted or decrypted values. `--web_hook` is also accepted as a longer alias for `--hook`.

## secret

Work with one Secret Vault by viewing, creating, updating, decrypting, or deleting it. A bare ID or fuzzy title opens safe vault metadata. Updates, decryption, and deletion require the exact internal Vault ID.

```sh
xy secret SECRET_VAULT_ID_OR_TITLE
xy secret get SECRET_VAULT_ID_OR_TITLE
xy secret list
xy secret create --title "My Vault" --fields @secrets.json
xy secret update SECRET_VAULT_ID --notes "Updated notes"
xy secret decrypt SECRET_VAULT_ID
xy secret delete SECRET_VAULT_ID
```

Creating, updating, decrypting, and deleting Secret Vaults requires an administrator API Key.

## secret list

List and filter Secret Vault metadata using the same options as `xy secrets`.

```sh
xy secret list
xy secret list --enabled true
xy secret list --plugin PLUGIN_ID
xy secret list --hook WEB_HOOK_ID
```

## secret get

View one Secret Vault's safe metadata, including variable names, assignments, notes, author, dates, and revision. Variable values are not returned by this operation.

```sh
xy secret SECRET_VAULT_ID_OR_TITLE
xy secret get --id SECRET_VAULT_ID
xy secret get --title "My Vault"
xy secret SECRET_VAULT_ID --format json
```

## secret create

Create a Secret Vault with a required title. New vaults default to enabled with no variables or assignments. Supply `fields` as a complete JSON array containing `name` and `value` strings.

```json
[
	{ "name": "API_TOKEN", "value": "replace-me" },
	{ "name": "PRIVATE_KEY", "value": "line one\nline two" }
]
```

Use a private file or standard input whenever practical. Putting plaintext values directly on the command line can save them in your shell history.

```sh
xy secret create --title "My Vault" --fields @secrets.json
cat secrets.json | xy secret create --title "My Vault" --fields @-
xy secret create --title "Service" --fields @secrets.json --events "EVENT_ID,EVENT_ID_2"
xy secret create --title "Shared" --fields @secrets.json --category CATEGORY_ID --plugin PLUGIN_ID --hook WEB_HOOK_ID
xy secret create --title "Empty Vault"
xy secret create --title "Preview" --fields @secrets.json --dry
```

Complete assignment lists are accepted through `events`, `categories`, `plugins`, and `web_hooks` as comma-separated strings or JSON arrays. The singular `event`, `category`, `plugin`, `web_hook`, and `hook` options append one or more IDs and may be repeated. Assignments must refer to objects visible to the configured API Key.

Variable names use the portable environment-variable form: letters, digits, and underscores, with a letter or underscore first. Names must be unique within a vault. Dry-run and verbose previews replace every variable value with `[REDACTED]`. `--format json` returns safe vault metadata only.

## secret update

Update a Secret Vault by exact ID. Omitted settings and encrypted variables remain unchanged.

```sh
xy secret update SECRET_VAULT_ID --title "New Title" --notes "Updated notes"
xy secret update SECRET_VAULT_ID --enabled false
xy secret update SECRET_VAULT_ID --events "EVENT_ID,EVENT_ID_2"
xy secret update SECRET_VAULT_ID --plugins '[]' --hook WEB_HOOK_ID
xy secret update SECRET_VAULT_ID --fields @secrets.json
cat secrets.json | xy secret update SECRET_VAULT_ID --fields @-
xy secret update SECRET_VAULT_ID --fields '[]'
xy secret update SECRET_VAULT_ID --notes "Preview" --dry
```

When `fields` is supplied, it must contain the complete replacement array. Individual variable updates, dotted field paths, and a singular `field` option are not supported. Omitting `fields` leaves all encrypted values untouched. Supplying `[]` removes every variable.

Complete assignment lists replace the saved lists. Singular assignment aliases append to the saved list without duplicates. Use an empty array to clear a list. Dry-run and verbose output always redact variable values.

## secret decrypt

Decrypt every variable in a Secret Vault by exact ID. Explicit confirmation is required because xyOps records this access in its activity log.

```sh
xy secret decrypt SECRET_VAULT_ID
xy secret decrypt SECRET_VAULT_ID --format json
xy secret decrypt SECRET_VAULT_ID --dry
```

Human-readable output gives each variable its own titled section and prints the value exactly, without a table or surrounding box. This preserves multiline values for selection and copying. JSON output is an array of plaintext `{ "name", "value" }` objects. Treat both forms as sensitive and avoid redirecting them to an insecure destination.

Without `--confirm`, the command displays the target vault and a warning without decrypting it. `--dry` does not decrypt the vault or create a secret-access audit event. Verbose diagnostics are redacted, while the final confirmed output intentionally contains plaintext.

## secret delete

Permanently delete a Secret Vault by exact ID. Explicit confirmation is required.

```sh
xy secret delete SECRET_VAULT_ID
xy secret delete --id SECRET_VAULT_ID
xy secret delete SECRET_VAULT_ID --dry
```

Deletion cannot be undone. Review Events, Categories, Plugins, and Web Hooks that may rely on the vault before deleting it. `--dry` previews the deletion without making changes.

## tags

List Tag definitions alphabetically by title. Search text matches IDs, titles, notes, and authors. Named filters may be combined.

```sh
xy tags
xy tags SEARCH_TEXT
xy tags --icon alert-rhombus
xy tags --title Production
xy tags --limit 10 --page 2
xy tags --format json
```

The table includes each Tag's ID, title, icon, number of matching Events, author, and modification time. Use `--limit`, `--page`, or `--offset` to page through human-readable output. JSON output includes every matching Tag definition.

## tag

Work with one Tag by viewing, creating, updating, or deleting it. A bare ID or fuzzy title opens the Tag details directly. Updates and deletes require the exact internal Tag ID.

```sh
xy tag TAG_ID_OR_TITLE
xy tag get TAG_ID_OR_TITLE
xy tag list
xy tag create --title "Production" --icon server
xy tag update TAG_ID --notes "Production workloads"
xy tag delete TAG_ID
```

The configured API Key needs `create_tags`, `edit_tags`, or `delete_tags` for the corresponding mutation. Listing and viewing Tags only require a valid API Key.

## tag list

List and filter Tag definitions using the same options as `xy tags`.

```sh
xy tag list
xy tag list SEARCH_TEXT
xy tag list --icon tag-outline
xy tag list --limit 10 --page 2
```

## tag get

View a Tag's title, icon, Event count, notes, author, dates, and revision. Exact IDs take precedence over fuzzy title matches.

```sh
xy tag TAG_ID_OR_TITLE
xy tag get --id TAG_ID
xy tag get --title "Production"
xy tag TAG_ID --format json
xy tag TAG_ID --export tag.json
xy events --tags TAG_ID
```

## tag create

Create a Tag with a required title. xyOps generates an ID unless you provide one. New Tags use the `tag-outline` icon by default and start with empty notes.

```sh
xy tag create --title "Production"
xy tag create --id production --title "Production"
xy tag create --title "High Priority" --icon alert-rhombus --notes "Needs attention"
xy tag create --title "From JSON" --json @tag.json
cat tag.json | xy tag create --json @-
xy tag create --title "Preview" --dry
```

Supported creation fields are `id`, `title`, `icon`, and `notes`. Tag IDs contain lowercase letters, digits, and underscores. IDs beginning with an underscore are reserved for system Tags, so user-defined IDs should not use that prefix. Material Design icon names may be supplied with or without the `mdi-` prefix.

## tag update

Update a Tag by exact ID. Omitted fields remain unchanged.

```sh
xy tag update TAG_ID --title "New Title"
xy tag update TAG_ID --icon tag-heart-outline
xy tag update TAG_ID --notes "Updated notes"
xy tag update TAG_ID --icon '' --notes ''
xy tag update TAG_ID --json @tag-update.json
cat tag-update.json | xy tag update TAG_ID --json @-
xy tag update TAG_ID --notes "Preview" --dry
```

Editable fields are `title`, `icon`, and `notes`. The Tag ID cannot be changed. Notes may contain multiple lines. `--dry` previews the changes, and `--format json` prints the updated Tag.

## tag delete

Permanently delete a Tag by exact ID. Explicit confirmation is required.

```sh
xy tag delete TAG_ID
xy tag delete --id TAG_ID
xy tag delete TAG_ID --dry
```

Deletion cannot be undone. Existing Events, historical Jobs, Tickets, Actions, and Limits may still refer to the deleted Tag. `--dry` previews the deletion without making changes.

## tickets

Search Tickets using the same search syntax as the xyOps web interface. A plain invocation lists all Tickets, newest first.

```sh
xy tickets
xy tickets "backup failure"
xy tickets 'subject:"release plan" status:open'
xy tickets --status open --type issue
xy tickets --assignee admin --tag important
xy tickets --category Production --created today
xy tickets --due '<today' --sort_dir asc
xy tickets --limit 25 --page 2
xy tickets --format json
```

Named search options include `subject`, `body`, `changes`, `status`, `username`, `assignees`, `cc`, `type`, `category`, `tags`, `created`, `due`, and `num`. Friendly aliases include `assignee`, `assign`, `tag`, `number`, and `date`. Category and Tag names may be supplied in place of IDs. Repeated or comma-separated values for one field are joined as alternatives.

Positional searches support quoted phrases, exclusions, alternatives, comparisons, and date ranges. Results show the newest Tickets first. Use `--sort_by FIELD` with `--sort_dir asc|desc` to change the order.

## ticket

Work with one Ticket using its friendly number or internal ID. Ticket numbers are shown with a `#` prefix, while internal IDs begin with `t`.

```sh
xy ticket 12345
xy ticket '#12345'
xy ticket get --num 12345
xy ticket get --id tabc123
xy ticket create --subject "Investigate backup failure" --status draft
xy ticket update 12345 close
xy ticket 12345 --comment "Investigation started."
xy ticket upload 12345 --file report.txt
xy ticket download 12345 FILE_ID
xy ticket delete 12345
```

Ticket numbers and internal IDs are accepted by all Ticket commands.

## ticket list

Search Tickets using the same interface as `xy tickets`.

```sh
xy ticket list
xy ticket list --status draft
xy ticket search "database timeout" --tag important
```

## ticket get

Display a Ticket summary with its number, internal ID, subject, status, type, assignments, due date, Tags, author, and timestamps. The Markdown body and each Markdown comment are rendered for the terminal. Attached Events, files, active Jobs, and completed Jobs are shown in separate sections.

```sh
xy ticket 12345
xy ticket get 12345
xy ticket get tabc123
xy ticket 12345 --limit 10 --page 2
xy ticket 12345 --format json
```

Pagination options apply to the completed Jobs attached to the Ticket. JSON output contains the complete Ticket.

## ticket create

Create a Ticket with a required subject. Defaults match the web editor: status `open`, type `change`, no assignments, no due date, and empty body, category, server, recipient, and Tag fields.

```sh
xy ticket create --subject "Investigate backup failure"
xy ticket create --subject "Draft release plan" --status draft --assign admin
xy ticket create --subject "Maintenance" --type maintenance --due "3 days"
xy ticket create --subject "Incident" --category Production --server host01
xy ticket create --subject "Review" --assignees "admin,oncall" --cc manager
xy ticket create --subject "External update" --notify "ops@example.com"
xy ticket create --subject "Detailed Ticket" --body @ticket.md
xy ticket create --subject "With files" --file report.txt --file metrics.json
xy ticket create --json @ticket.json
cat ticket.json | xy ticket create --json @-
xy ticket create --subject "Preview" --status draft --dry
```

Supported fields are `id`, `subject`, `body`, `type`, `status`, `category`, `server`, `assignees`, `cc`, `notify`, `due`, and `tags`. Ticket types are `issue`, `feature`, `release`, `change`, `maintenance`, `question`, and `other`. Statuses are `draft`, `open`, and `closed`.

List fields accept JSON arrays, comma-separated strings, or repeated singular `--assign` and `--tag` options. The `body` is always treated as Markdown text, including JSON-looking content loaded from a `.json` file. A due date may be a Unix timestamp or a relative duration such as `3 days`.

Draft Tickets suppress email notifications. This is useful when composing a Ticket incrementally or creating test data.

## ticket update

Update a Ticket using its number or internal ID. Omitted fields remain unchanged.

```sh
xy ticket update 12345 --subject "Updated subject"
xy ticket update 12345 --body @ticket.md
xy ticket update 12345 --status closed
xy ticket update 12345 close
xy ticket update 12345 open
xy ticket update 12345 draft
xy ticket update 12345 --assign admin
xy ticket update 12345 --tag important
xy ticket update 12345 --assignees '["admin","oncall"]'
xy ticket update 12345 --tags "important,production"
xy ticket update 12345 --due "1 week"
xy ticket update 12345 --due 0
xy ticket update 12345 --json @ticket-update.json
xy ticket update 12345 --subject "Preview" --dry
```

The plain actions `close`, `open`, and `draft` set the corresponding status. `reopen` is also accepted as an alias for `open`. `--assign USERNAME` appends to the complete saved `assignees` array, and `--tag TAG_ID_OR_TITLE` appends to the saved `tags` array. Existing values are not duplicated. In contrast, `--assignees` and `--tags` replace their respective arrays completely.

Ticket Event assignments are read-only in the CLI. Use the xyOps web interface to edit them.

## ticket comment

Add a Markdown comment to a Ticket. Comments may be supplied with the convenient detail shortcut or with the explicit command.

```sh
xy ticket 12345 --comment "Investigation started."
xy ticket comment 12345 --body "**Resolved:** Restarted the service."
xy ticket comment 12345 --body @comment.md
cat comment.md | xy ticket comment 12345 --body @-
xy ticket comment 12345 --body @comment.md --dry
```

Adding a comment can notify Ticket assignees and recipients unless the Ticket status is `draft`. Editing and deleting comments are not currently supported by the CLI.

## ticket upload

Upload one or more files and save them as Ticket attachments. Both `--file` and `--files` may be repeated, and every local path must identify a regular file.

```sh
xy ticket upload 12345 --file report.txt
xy ticket upload 12345 --file report.txt --file metrics.json
xy ticket upload 12345 --files '["report.txt","metrics.json"]'
xy ticket upload 12345 --file report.txt --dry
```

Attachment deletion is not currently supported by the CLI.

## ticket download

Download one Ticket attachment to disk. Supply either the unique File ID shown by `ticket get`, or an exact filename. If a Ticket contains multiple attachments with the same filename, use the File ID to select one unambiguously.

```sh
xy ticket download 12345 FILE_ID
xy ticket download 12345 report.txt
xy ticket download 12345 FILE_ID ./downloads/report.txt
xy ticket download 12345 FILE_ID --output ./report-copy.txt
xy ticket download --id tabc123 --file FILE_ID --download ./report-copy.txt
xy ticket download 12345 FILE_ID --dry
```

The output path defaults to the attachment's original filename in the current directory. The command refuses to overwrite an existing local file. A dry run shows the selected Ticket, attachment, and destination without writing anything.

## ticket delete

Permanently delete a Ticket using its number or internal ID. Explicit confirmation is required.

```sh
xy ticket delete 12345
xy ticket delete --id tabc123
xy ticket delete 12345 --dry
```

Deletion cannot be undone. `--dry` previews the deletion without making changes.

## hooks

List Web Hook definitions alphabetically by title. Search text matches IDs, titles, URLs, notes, and authors. Named filters may be combined.

```sh
xy hooks
xy hooks SEARCH_TEXT
xy hooks --enabled false
xy hooks --method POST
xy hooks --url example.com
xy hooks --limit 10 --page 2
xy hooks --format json
```

The table includes each Hook's ID, title, HTTP method, URL, status, and modification time. Use `--limit`, `--page`, or `--offset` to page through human-readable output. JSON output includes every matching Web Hook definition.

## hook

Work with one Web Hook by viewing, creating, updating, testing, or deleting it. A bare ID or fuzzy title opens the Hook details directly. Updates, tests, and deletes require the exact internal Hook ID.

```sh
xy hook HOOK_ID_OR_TITLE
xy hook get HOOK_ID_OR_TITLE
xy hook list
xy hook create --title "My Hook" --url https://example.com/hook
xy hook update HOOK_ID --enabled false
xy hook test HOOK_ID
xy hook delete HOOK_ID
```

The configured API Key needs `create_web_hooks`, `edit_web_hooks`, or `delete_web_hooks` for the corresponding mutation. Testing requires `edit_web_hooks`. Listing and viewing Hooks only require a valid API Key.

## hook list

List and filter Web Hook definitions using the same options as `xy hooks`.

```sh
xy hook list
xy hook list SEARCH_TEXT
xy hook list --enabled true --method POST
xy hook list --limit 10 --page 2
```

## hook get

View a Web Hook's request settings, headers, body, notes, author, dates, and revision. Exact IDs take precedence over fuzzy title matches.

```sh
xy hook HOOK_ID_OR_TITLE
xy hook get --id HOOK_ID
xy hook get --title "My Hook"
xy hook HOOK_ID --format json
xy hook HOOK_ID --export hook.json
```

## hook create

Create a Web Hook with a required title and URL. New Hooks default to enabled with method `POST`, a 30-second timeout, no retries, no redirect following, normal TLS certificate verification, and an unlimited daily cap.

```sh
xy hook create --title "My Hook" --url https://example.com/hook
xy hook create --id deploy_hook --title "Deploy" --url https://example.com/deploy --method POST
xy hook create --title "JSON API" --url https://example.com/api --headers @headers.json --body @body.json
xy hook create --title "Custom Header" --url https://example.com/api --header '{ "name":"Authorization", "value":"Bearer {{ secrets.API_TOKEN }}" }'
xy hook create --title "From JSON" --json @hook.json
cat hook.json | xy hook create --json @-
xy hook create --title "Preview" --url https://example.com/hook --dry
```

Supported fields are `id`, `title`, `enabled`, `icon`, `url`, `method`, `headers`, `body`, `timeout`, `retries`, `follow`, `ssl_cert_bypass`, `max_per_day`, and `notes`. The URL must begin with `http://`, `https://`, or `{{` for a complete template expression. Methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, and `DELETE`.

The default headers are `Content-Type: application/json` and `User-Agent: xyOps/WebHook`. Use `--headers '[]'` to start with no headers. A whole `headers` array replaces the default, while each `header` option appends one `{ "name", "value" }` object. Both options accept JSON files, and singular options may be repeated.

`timeout`, `retries`, and `max_per_day` are non-negative integers. A timeout of `0` waits indefinitely, and a daily cap of `0` is unlimited. `follow` and `ssl_cert_bypass` are booleans. TLS bypass is intended only for endpoints using self-signed certificates.

URLs, header values, and bodies may contain xyOps template expressions such as `{{ text }}` and `{{ secrets.API_TOKEN }}`. Assign the Secret Vault to the Web Hook before using a secret expression.

## hook update

Update a Web Hook by exact ID. Omitted settings remain unchanged.

```sh
xy hook update HOOK_ID --title "New Title" --enabled false
xy hook update HOOK_ID --url https://example.com/new --method PUT
xy hook update HOOK_ID --timeout 60 --retries 2 --follow true
xy hook update HOOK_ID --ssl_cert_bypass true --max_per_day 100
xy hook update HOOK_ID --body @body.txt
xy hook update HOOK_ID --headers '[{"name":"X-My-Name","value":"My Value"}]'
xy hook update HOOK_ID --headers @headers.json
xy hook update HOOK_ID --headers.0.name "X-New-Name" --headers.0.value "New Value"
xy hook update HOOK_ID --header '{ "name":"X-Another", "value":"Another Value" }'
xy hook update HOOK_ID --headers '[]'
xy hook update HOOK_ID --json @hook-update.json
cat hook-update.json | xy hook update HOOK_ID --json @-
xy hook update HOOK_ID --timeout 60 --dry
```

A complete `headers` array replaces all saved headers. Dotted paths edit existing zero-based entries, and repeated `header` options append after replacement and dotted edits. Use `[]` to clear the list. Header names and values are checked using the same rules as the xyOps editor, including rejection of newline characters in values.

The Hook ID cannot be changed. `--dry` previews the changes, and `--format json` prints the updated Web Hook.

## hook test

Perform a real HTTP request using a saved Web Hook and show a detailed report. Testing does not save changes to the Hook.

```sh
xy hook test HOOK_ID
xy hook test HOOK_ID --timeout 10
xy hook test HOOK_ID --url https://httpbin.org/post --method POST
xy hook test HOOK_ID --headers @test-headers.json --body @test-body.json
xy hook test HOOK_ID --format json
xy hook test HOOK_ID --dry
```

Any supplied Hook fields apply only to the test. Without overrides, the saved definition is used exactly. `--dry` previews the test without contacting the destination.

The report includes the result, request, response, and performance metrics. Template expressions are expanded as they would be during a real execution. This can include decrypted Secret Vault values in request headers or bodies, so review terminal logging and redirection before testing a Hook that uses secrets. Use `--format json` for structured output.

## hook delete

Permanently delete a Web Hook by exact ID. Explicit confirmation is required.

```sh
xy hook delete HOOK_ID
xy hook delete --id HOOK_ID
xy hook delete HOOK_ID --dry
```

Deletion cannot be undone. Events, workflows, Categories, server groups, Alerts, and Secret Vaults may still refer to the deleted Web Hook. `--dry` previews the deletion without making changes.

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
xy category delete CAT_ID
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

As with events, `--actions` and `--limits` supply complete JSON arrays, while `--action` and `--limit` append objects. Singular options can be repeated. Here `--limit` is a resource limit object, while list commands use it for pagination. Add `--format json` to print the created Category.

## category update

Update a Category by exact ID. Omitted fields remain unchanged. Dotted updates preserve the other array entries and settings.

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

Editable fields are `title`, `enabled`, `color`, `icon`, `notes`, `sort_order`, `actions`, and `limits`. The ID cannot be changed. `sort_order` is a non-negative integer and does not renumber other Categories.

Numerical array indexes must already exist. Use the singular `--action` or `--limit` option to append, or the plural option to replace an entire array. Supply `[]` to clear an array; to remove one entry, submit a replacement array without it. When combining array replacement and dotted edits, the replacement is applied first, followed by dotted edits and then singular appends.

Disabling a Category prevents scheduling and manual launches for all its Events and workflows. `--dry` previews the changes. `--format json` prints the updated Category.

## category delete

Permanently delete a category by exact ID. Explicit confirmation is required, and xyOps refuses deletion while any events or workflows still belong to the category. Move or delete those events first.

```sh
xy category delete CAT_ID
xy category delete --id CAT_ID
xy category delete CAT_ID --dry
```

`--dry` previews the deletion without making changes.

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
xy channel delete CHANNEL_ID
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

Update a Channel by exact ID. Omitted settings remain unchanged. The ID cannot be changed.

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

Disabling a Channel causes actions that reference it to skip its notifications. `--dry` previews the changes, and `--format json` prints the updated Channel.

## channel delete

Permanently delete a channel by exact ID. Explicit confirmation is required.

```sh
xy channel delete CHANNEL_ID
xy channel delete --id CHANNEL_ID
xy channel delete CHANNEL_ID --dry
```

Deletion does not remove references from Events, workflows, Categories, server groups, or Alerts. Update those actions when replacing a Channel. `--dry` previews the deletion without making changes.

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
xy monitor delete MONITOR_ID
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

Update a Monitor by exact ID. Omitted settings remain unchanged. The ID cannot be changed.

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

The editable fields are the same as create, and `sort_order` can be set to an integer to change the Monitor's position. Lower sort orders appear first. Supply negative numbers through a JSON file or standard input. A whole `--groups` list replaces the saved list, dotted paths edit existing indexes, and repeated `--group` options append IDs afterward. Use `--groups '[]'` to apply the Monitor to all groups.

`--dry` previews the changes, and `--format json` prints the updated Monitor.

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

An unsaved expression defaults to `float`. Tests evaluate the source, apply `data_match` if set, and convert the result to the selected data type. They do not calculate changes between samples or apply delta settings. A successful zero is displayed as `0`; an expression that cannot be evaluated displays `No Value`. Invalid expressions and unmatched regular expressions are reported as errors.

JSON output includes the calculated value or failure status. Testing requires the `edit_monitors` privilege.

## monitor delete

Permanently delete a monitor by exact ID. Explicit confirmation is required.

```sh
xy monitor delete MONITOR_ID
xy monitor delete --id MONITOR_ID
xy monitor delete MONITOR_ID --dry
```

Review any Alert expressions that refer to the Monitor before deleting it. `--dry` previews the deletion without making changes.

## marketplace

Search the xyOps Plugin Marketplace. The Marketplace currently contains Plugins for Events, Monitors, Actions, and Schedulers.

```sh
xy marketplace
xy marketplace AI
xy marketplace search backup
xy marketplace --plugin_type event
xy marketplace --author PixlCore
xy marketplace --license MIT --requires npx
xy marketplace --tags AI,Prompt
xy marketplace --status installed
xy marketplace --status not
xy marketplace --sort_by modified --sort_dir desc
xy marketplace --limit 10 --page 2
xy marketplace --format json
```

Positional text or `--query` searches titles, descriptions, IDs, licenses, tags, and requirements. Plugin types are `event`, `monitor`, `action`, and `scheduler`. The `tags` and `requires` filters accept comma-separated values or repeated options, and all selected values must match. Status is either `installed` or `not`.

Sort fields are `title`, `author`, `license`, `plugin_type`, `created`, and `modified`; sort direction is `asc` or `desc`. JSON output contains the current page of Marketplace results.

## marketplace list

List Marketplace Plugins using the same filters and pagination options as `xy marketplace`.

```sh
xy marketplace list
xy marketplace list --plugin_type monitor
xy marketplace list --status installed
```

## marketplace search

Search Marketplace Plugins using the same filters and pagination options as `xy marketplace`.

```sh
xy marketplace search AI
xy marketplace search backup --requires npx
xy marketplace search --query notification --license MIT
```

## marketplace get

View one Marketplace Plugin by its exact `AUTHOR/REPO` ID. The detail view includes listing metadata, installation status, available versions, requirements, tags, and the complete README rendered for the terminal. Images are omitted because terminals cannot display them.

```sh
xy marketplace pixlcore/xyplug-ai
xy marketplace get pixlcore/xyplug-ai
xy marketplace get pixlcore/xyplug-ai --version v1.0.9
xy marketplace get --id pixlcore/xyplug-ai
xy marketplace pixlcore/xyplug-ai --format json
```

The latest published version is shown by default. Use `--version` to read an older published version. Use `--format json` for the complete listing details and original README Markdown.

## marketplace install

Preview and install one Marketplace Plugin by its exact `AUTHOR/REPO` ID. The preview shows the Plugin definition and displays embedded scripts separately with syntax highlighting. **No Plugin is installed or upgraded until you add `--confirm`.**

```sh
xy marketplace install pixlcore/xyplug-ai
xy marketplace install pixlcore/xyplug-ai --version v1.0.9
xy marketplace install pixlcore/xyplug-ai --dry
xy marketplace install pixlcore/xyplug-ai --format json
```

The preview verifies that the package is compatible and explains whether it will install a new Plugin or upgrade an existing one. It also warns if the matching Plugin ID belongs to a local Plugin from another source. Use `--format json` for a structured preview.

Installation requires permission to create or update Plugins. The command does not execute or test the Plugin. Review its README, requirements, source repository, embedded script, and parameter definitions before confirming installation.

## plugins

List Plugin definitions alphabetically by title, including IDs, types, status, parameter counts, and modification times. Search text matches IDs, titles, executable commands, scripts, and notes.

```sh
xy plugins
xy plugins SEARCH_TEXT
xy plugins --type event
xy plugins --type monitor --enabled true
xy plugins --enabled false
xy plugins --limit 10 --page 2
xy plugins --format json
```

Supported Plugin types are `event`, `monitor`, `action`, and `scheduler`. Named filters can be combined. `--limit`, `--page`, and `--offset` page through the table. JSON output includes all matching Plugin definitions.

## plugin

View, create, update, or delete a Plugin. A bare ID or fuzzy title opens its details. Updates and deletes require an exact Plugin ID.

```sh
xy plugin PLUGIN_ID_OR_TITLE
xy plugin get PLUGIN_ID_OR_TITLE
xy plugin list
xy plugin create --title "My Plugin" --type event --command node --script @plugin.js
xy plugin update PLUGIN_ID --enabled false
xy plugin delete PLUGIN_ID
```

xyOps supports four kinds of Plugin. Event Plugins run jobs, Monitor Plugins gather server metrics, Action Plugins respond to job or alert conditions, and Scheduler Plugins provide custom scheduling decisions.

## plugin list

List and filter Plugin definitions using the same options as `xy plugins`.

```sh
xy plugin list
xy plugin list --type action --enabled true
xy plugin list --limit 10 --page 2
```

## plugin get

View a Plugin's executable, script summary, type-specific settings, notes, source, and revision metadata. Non-monitor Plugins also show their parameter definitions. Exact IDs take precedence over fuzzy title matches.

```sh
xy plugin PLUGIN_ID_OR_TITLE
xy plugin get --id PLUGIN_ID
xy plugin get --title "My Plugin"
xy plugin PLUGIN_ID --format json
xy plugin PLUGIN_ID --verbose
xy plugin PLUGIN_ID --export plugin.json
```

Normal output summarizes the embedded script without printing its contents. Add `--verbose` to display the complete syntax-highlighted script and expanded values for code, textarea, and JSON parameter defaults.

## plugin create

Create an Event, Monitor, Action, or Scheduler Plugin. Every Plugin requires a title, type, and executable command. The default type is `event`, so `--type event` may be omitted. xyOps generates an ID unless you supply `--id`.

```sh
xy plugin create --title "My Event Plugin" --type event --command node --script @plugin.js
xy plugin create --id cleanup --title "Cleanup" --command /bin/sh --script @cleanup.sh
xy plugin create --title "Remote Runner" --type event --command node --runner true --kill all
xy plugin create --title "CPU Sensor" --type monitor --command /bin/sh --script @sensor.sh --plugin_format json --groups '["GROUP_ID"]'
xy plugin create --title "Fast Sensor" --type monitor --command node --quick true --group GROUP_ID
xy plugin create --title "Notify Service" --type action --command python3 --script @notify.py
xy plugin create --title "Business Calendar" --type scheduler --command node --script @calendar.js
xy plugin create --title "Parameterized" --command node --param '{ "id":"name", "title":"Name", "type":"text", "value":"World" }'
xy plugin create --title "Imported Parameters" --command node --params @params.json
xy plugin create --json @plugin.json
cat plugin.json | xy plugin create --json @-
xy plugin create --title "Preview" --command node --dry
```

Common fields are `id`, `title`, `enabled`, `type`, `icon`, `command`, `script`, `uid`, `gid`, and `notes`. Use `--script @FILE` for source code or `--script @-` to read it from standard input. `command` contains the executable and optional arguments, without pipes or redirects. `uid` and `gid` select the Unix account used to run the process when supported.

Event Plugins also accept `kill` with `none`, `parent`, or `all`, plus the `runner` boolean for remote job runners. Monitor Plugins accept `groups`, `plugin_format`, and `quick`; `plugin_format` is `text`, `json`, or `xml`, an empty group list means all groups, and `quick` also runs the Plugin through QuickMon every second. When loading a complete Plugin definition with `--json`, use `format` instead of `plugin_format`. Action and Scheduler Plugins use the common fields and may define parameters.

Non-monitor Plugins accept parameter definitions through `params` and `param`. `--params` supplies the complete JSON array, while each `--param` appends one object. Supported parameter types are `text`, `textarea`, `code`, `json`, `checkbox`, `select`, `bucket`, `system`, `hidden`, `toolset`, and `group`. Add `--format json` to print the created Plugin.

## plugin update

Update a Plugin by exact ID. Omitted settings remain unchanged. A Plugin's ID and type cannot be changed after creation.

```sh
xy plugin update PLUGIN_ID --title "New Title" --notes "Updated notes"
xy plugin update PLUGIN_ID --enabled false
xy plugin update PLUGIN_ID --command node --script @plugin.js
xy plugin update PLUGIN_ID --uid worker --gid workers
xy plugin update PLUGIN_ID --params @params.json
cat params.json | xy plugin update PLUGIN_ID --params @-
xy plugin update PLUGIN_ID --param '{ "id":"foo", "title":"Foo", "type":"text", "value":"hello" }'
xy plugin update PLUGIN_ID --params.0.title "New Parameter Title"
xy plugin update PLUGIN_ID --params.0.required true
xy plugin update PLUGIN_ID --params '[]'
xy plugin update EVENT_PLUGIN_ID --kill parent --runner false
xy plugin update MONITOR_PLUGIN_ID --groups '["GROUP_ID"]' --plugin_format json --quick true
xy plugin update MONITOR_PLUGIN_ID --group GROUP_ID --group ANOTHER_GROUP_ID
xy plugin update MONITOR_PLUGIN_ID --groups.0 GROUP_ID
xy plugin update PLUGIN_ID --enabled false --dry
```

For non-monitor Plugins, a whole `--params` array replaces all parameter definitions, dotted paths edit existing zero-based indexes, and repeated `--param` options append definitions afterward. Use `[]` to clear the list or submit a replacement array without an item to remove it. When the options are combined, replacement happens first, followed by dotted edits and appends.

For Monitor Plugins, `--groups` replaces the complete server-group list, dotted paths edit existing indexes, and repeated `--group` options append IDs without duplicates. Monitor Plugins do not support parameter definitions, and other Plugin types do not support monitor-only settings. `--dry` previews the changes, and `--format json` prints the updated Plugin.

## plugin delete

Permanently delete a Plugin by exact ID. Explicit confirmation is required.

```sh
xy plugin delete PLUGIN_ID
xy plugin delete --id PLUGIN_ID
xy plugin delete PLUGIN_ID --dry
```

Before deleting a Plugin, review Events, workflows, Monitors, triggers, and Actions that may reference it. Deletion does not remove those references. `--dry` previews the deletion without making changes.

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

View, create, update, delete, or run an Event. A bare ID or title opens the Event details directly.

```sh
xy event ID_OR_TITLE
xy event get ID_OR_TITLE
xy event create --title "My Event" --plugin testplug
xy event update EVENT_ID --enabled false
xy event delete EVENT_ID
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

Default Category, Plugin, target, and algorithm values are used where possible. Dotted options set nested values, while `--cron`, `--interval`, `--seconds`, and `--catchup` add common triggers.

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

Dotted options preserve other settings, and numerical array indexes must already exist. The singular `--action`, `--trigger`, `--limit`, and `--field` options append new objects to their corresponding arrays.

## event delete

Permanently delete an event using its exact ID. The command requires explicit confirmation and can optionally remove the event's historical jobs in the background.

```sh
xy event delete EVENT_ID
xy event delete EVENT_ID --delete_jobs
xy event delete EVENT_ID --dry
```

Deletion is blocked while the Event has active Jobs. Use `--dry` to preview the deletion without making changes.

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

`xy run` is the short form of `xy event run`. Extra options temporarily override the saved Event settings, and dotted option names set nested values.

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

Rerun a completed, Event-backed Job using its previous settings. Add `--follow` to stream the new Job, or use `--dry` to preview the rerun first.

```sh
xy job run JOB_ID
xy job run JOB_ID --follow
xy job run JOB_ID --dry
```

Ad hoc jobs and ad hoc workflow sub-jobs cannot be rerun independently.

## job resume

Resume a suspended active Job, optionally providing new parameter or input values. Use dotted options for nested values.

```sh
xy job resume JOB_ID
xy job resume JOB_ID --params.example VALUE
xy job resume JOB_ID --input.data.example VALUE
xy job resume JOB_ID --dry
```

## job abort

Abort an active Job that should no longer continue running. Use `--dry` to preview the action without interrupting the Job.

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

Default output shows complete bracket-delimited log lines using the server's configured column order. Brackets are gray and column values are color-coded. JSON output includes all log columns by default, including `data` as a string. An explicit `--cols` selection applies to either output format and does not limit which parts of each line are searched.

The search selects the last N matches before applying the display order, so `--sort date_asc` does not select the earliest N matches. There is no numbered pagination; use `--rows` rather than `--limit`, `--offset`, or `--page`. The summary's total row count includes non-matching lines.

Missing logs or archives return an empty result. `--dry` previews the search. To view a particular Job's output instead, use `xy job log JOB_ID`.
