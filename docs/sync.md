# Filesystem Sync Guide

Filesystem sync connects your existing xyOps automation with local files. Keep Event definitions and Plugin scripts in Git, edit them with your favorite tools, review changes as diffs, and send them to xyOps. You can also pull changes made in the web interface back into your local tree.

**Your file and directory layout is completely free-form.** Organize definitions into any folders you like and give their JSON files any names you want. The sync engine searches recursively and identifies each definition by the type and ID inside the file, so its contents determine what it syncs. You can move or rename files later without changing their identity or triggering a sync. Keep the `.json` extension, and move or rename any external property files alongside their matching definition so they remain linked.

This guide covers initial setup, file layouts, every sync option, saved configuration, one-way and two-way operation, deletion, completion commands, notifications, and automatic runs.

**Sync command reference:** [Sync](help.md#sync), [Sync setup](help.md#sync-setup), and [CLI configuration](help.md#config).

## Contents

- [Choose your workflow](#choose-your-workflow)
- [Supported resources and requirements](#supported-resources-and-requirements)
- [Set up your first sync tree](#set-up-your-first-sync-tree)
- [Files, folders, and external properties](#files-folders-and-external-properties)
- [Run sync and review differences](#run-sync-and-review-differences)
- [Configuration and option reference](#configuration-and-option-reference)
- [Two-way sync and modification times](#two-way-sync-and-modification-times)
- [Remote-management warnings](#remote-management-warnings)
- [Delete mode](#delete-mode)
- [Completion commands](#completion-commands)
- [Error notifications](#error-notifications)
- [Built-in PID locking](#built-in-pid-locking)
- [Automatic sync with cron](#automatic-sync-with-cron)
- [Automatic upsync with Git hooks](#automatic-upsync-with-git-hooks)
- [Automatic upsync with GitHub Actions](#automatic-upsync-with-github-actions)
- [Troubleshooting and operational limits](#troubleshooting-and-operational-limits)

## Choose your workflow

Sync has two directions. **Up** sends local definitions to xyOps. **Down** writes xyOps definitions back to local files. You select directions independently for each resource type.

| Workflow | Typical command | Use it when |
| --- | --- | --- |
| Local files are authoritative | `xy sync ./ --up events,plugins` | You want editor and Git changes to determine the saved definitions in xyOps. |
| xyOps is authoritative | `xy sync ./ --down events,plugins` | You edit in the web interface and want a local history or backup of selected definitions. |
| Different sources for different types | `xy sync ./ --up plugins --down events` | Developers own Plugin source while operators manage Event definitions in xyOps. |
| Both sides can change | `xy sync ./ --up events,plugins --down events,plugins` | You accept modification-time conflict handling and have a persistent working directory. |

**Sync applies changes immediately. There is no confirmation step.** Add `--dry` to preview a run before allowing it to change xyOps or your files.

Sync updates *changes* to objects that already exist on both sides. It does not create new xyOps objects, generate local files for newly created objects (except during [setup](#set-up-your-first-sync-tree)), or remove local files when objects disappear from xyOps. Use resource creation commands or imports to create objects, and setup or exports to introduce their local files.

For a Git-based deployment workflow, start with up-only sync. A fresh checkout is a good source for an explicit push, but its filesystem timestamps are not reliable evidence for two-way conflict decisions.

## Supported resources and requirements

Install and connect xyCLI as described in [Getting started](../README.md#getting-started). The CLI requires Node.js 20.19.0 or later and xyOps 1.0.96 or later. The machine running sync needs network access to the xyOps API and access to the local directories you select.

Use these names with `--up`, `--down`, `--delete`, and setup:

| Selection name | Definitions |
| --- | --- |
| `alerts` | Alert definitions, rather than their invocations. |
| `api_keys` | API Key definitions. |
| `buckets` | Bucket definitions, JSON data, and uploaded files. Requires xyOps 1.1.2 or later. |
| `categories` | Event Categories. |
| `channels` | Notification Channels. |
| `events` | Events and workflows. |
| `groups` | Server Groups. |
| `monitors` | Monitor definitions. |
| `plugins` | Event, Monitor, Action, and Scheduler Plugins. |
| `tags` | Tag definitions. |
| `web_hooks` | Web Hook definitions. |

`all` selects every supported type. Supply multiple types as a comma-separated string without spaces, such as `events,plugins,categories`.

Secret Vaults, Users, and Roles are not supported by sync. Individual workers, jobs, Tickets, Alert history, and snapshots are also outside its definition-sync scope. Workflows use the `events` selection even though setup places them in a separate folder (for convenience).

### Permissions

Your API Key needs permission to read the definitions you scan and to edit each type you push. Delete mode additionally requires the corresponding delete privileges. Resource restrictions, such as Category and Group access, still apply.

Sync also maintains remote-management tracking which requires the [update_state](https://docs.xyops.io/privileges/update_state) privilege. A pull or two-way run can update this tracking too. Notification email requires the [send_emails](https://docs.xyops.io/privileges/send_emails) privilege; an error Event requires the [run_jobs](https://docs.xyops.io/privileges/run_jobs) privilege, permission to use that Event's resources, and an enabled manual trigger.

Before using deletion, ensure your key can see the entire inventory for every selected type. A restricted view is not an adequate basis for maintaining a complete tree.

**Learn more about xyOps:** [xyOps API Keys](https://docs.xyops.io/api#api-keys) and [xyOps Privileges](https://docs.xyops.io/privileges).

## Set up your first sync tree

Setup exports existing definitions into a local starter tree. The `sync setup` command does not change anything in xyOps, and it is separate from a regular sync run.

### 1. Start with a fresh directory

```sh
mkdir xyops-automation
cd xyops-automation
```

Setup always writes below the current working directory. Type names after `setup` are resource selections, not destination paths. The `base_dirs` configuration property and direction settings do not choose setup's destination.

### 2. Preview the export

```sh
xy sync setup events plugins categories --file_props script,params.script --dry
```

The `--file_props` switch will externalize specific JSON property paths into individually named files, for easy editing.  This is great for storing Plugin scripts, Event shell scripts, and workflow node scripts in separate files alongside the main JSON definition files.

The preview lists the folders and files that would be written. `--dry` creates no directories or files.

### 3. Write the files

```sh
xy sync setup events plugins categories --file_props script,params.script
```

Depending on your saved definitions, the result might look like this:

```text
xyops-automation/
    categories/
        Backups.json
    events/
        Operations/
            Nightly-Backup.json
            Nightly-Backup-params.script.sh
    plugins/
        Custom-Runner.json
        Custom-Runner-script.js
    workflows/
        Deployments/
            Release-Pipeline.json
            Release-Pipeline-workflow.nt3sr3y4.params.script.sh
```

Setup creates one folder per selected resource type and one JSON file per definition. Event and workflow exports are separated into `events/` and `workflows/`, then grouped into subfolders using their Category titles. Both participate in normal sync through the `events` selection.

Bucket setup also creates a sibling directory for each Bucket's content. For example, a Bucket titled `My Bucket Name` has `buckets/My-Bucket-Name.json`, `buckets/My-Bucket-Name/data.json`, and `buckets/My-Bucket-Name/files/` for its definition, data, and uploaded files. Move or rename the sibling directory with the XYPDF file. A normal Bucket sync requires both the data file and files directory, even when they contain an empty object and no files. Bucket data upsync replaces the full remote data object, including removed keys. File transfers match xyOps normalized filenames and align local modification times with the server's timestamps after each transfer.

Folder and filenames come from Category and definition titles: sequences of non-word characters become hyphens, and leading or trailing hyphens are removed. For example, the Event `Nightly Backup` in the `Operations` Category becomes `events/Operations/Nightly-Backup.json`. Different titles can produce the same path, so review the preview for collisions. Setup stops before writing anything if an Event or workflow selected for export refers to a Category that is not present in xyOps.

### 4. Review and version the tree

Optionally use git to version your files.  You can actually use any SCM you want, or none at all.  The sync engine works on raw files, and doesn't care how they are managed.

```sh
git init
git add .
git commit -m "Add xyOps automation definitions"
xy sync ./ --up events,plugins,categories --dry
```

Review the generated definitions, scripts, and any embedded request headers or credentials before sharing the repository.

### Export stock and Marketplace definitions

Setup normally omits objects marked as stock or installed from the Marketplace. To include them:

```sh
xy sync setup all --stock --marketplace --file_props script,params.script
```

These switches are optional export choices, not requirements for delete mode. Objects with a `stock` or `marketplace` property are always excluded from sync deletion, even when they have no local file. Leave Marketplace Plugins managed by the Marketplace and its upgrade system; a standard sync tree can focus on definitions you maintain yourself.

### Rerun setup carefully

Without `--force`, setup stops if an output file already exists. Earlier files written during that run remain; setup is not an all-or-nothing transaction.

```sh
xy sync setup events plugins --force
```

`--force` allows generated JSON and external files to be overwritten. It does not clean up old filenames, solve filename collisions, or preserve your local edits. Export into a fresh directory when adding newly created objects, then move their reviewed files into the existing tree. 

To add only definitions that are new to an existing sync tree, run setup from the tree's root with `--new`:

```sh
xy sync setup events plugins categories --new --file_props script,params.script --dry
xy sync setup events plugins categories --new --file_props script,params.script
```

New-only setup scans the current directory recursively and indexes existing XYPDF sources by item type and exact ID. Renamed files and custom folders are preserved. Remote definitions not found in that index are written to setup's normal type and Category folders; existing definitions are skipped without being rewritten. Malformed, duplicate, unsupported, or locally orphaned sources stop the operation before new files are written. `--new` cannot be combined with `--force`.

This is an additive local export. It does not create definitions in xyOps, and ordinary upsync or downsync still updates only definitions that already exist on both sides.

Alternatively, you can export single objects at a time:

```sh
xy event EVENT_ID --export ./events/New-Event.json
```

Keep this export to one object, without `--deps`. Multi-object exports cannot be used as a sync source.

## Files, folders, and external properties

### One definition per XYPDF file

Sync sources are plain `.json` files containing exactly one XYPDF item. A minimal illustration is:

```json
{
	"type": "xypdf",
	"description": "xyOps Portable Data Object",
	"version": "1.0",
	"xyops": "1.0.96",
	"items": [
		{
			"type": "category",
			"data": {
				"id": "EXISTING_CATEGORY_ID",
				"title": "Backups",
				"enabled": true,
				"color": "blue",
				"actions": [],
				"limits": []
			}
		}
	]
}
```

Normally you should let setup or export generate the wrapper. Keep the object's original `data.id`: sync matches the **item type and exact ID**, not the title, filename, or folder name.

The optional `xyops` field declares a minimum required xyOps version. Sync rejects a source requiring a newer version than your instance. The `version` field is the XYPDF format version (should be `1.0`).

Gzip-compressed exports and multi-item XYPDF files cannot be sync sources. Sync files may still contain sensitive definition data, such as scripts or Web Hook headers.

### Organize folders your way

Normal sync scans the selected directories recursively. You may move or rename definitions to organize them by project, environment, or team:

```sh
xy sync ./team-a ./team-b --up events,plugins --dry
```

Keep one source per resource type and ID, and avoid overlapping base directories. The engine detects repeated sources for the same type and ID, emits a warning naming each later duplicate file, and skips those duplicates during scanning. Identical copies count as duplicates too; equal IDs in different resource types do not.

As with other scan warnings, a duplicate warning stops the entire run before definition updates, downloads, tracking changes, or deletion. Remove the extra sources or overlapping scan paths, then run sync again.

Hidden files and hidden directories are skipped, including `.git/`. However, note that a `.gitignore` rule does not control sync discovery. Other valid JSON files without an XYPDF wrapper are skipped, but malformed `.json` files generate warnings. Keep unrelated JSON files and dependency directories outside the scanned tree where possible.

### Keep scripts in external files

`--file_props` tells setup to extract selected nonempty string properties. For example:

```sh
xy sync setup events plugins --file_props script,params.script
```

This extracts the selected content, if found, and moves it to a neighboring file:

| Definition | Property | Neighbor file |
| --- | --- | --- |
| `My-Plugin.json` | `script` | `My-Plugin-script.js` |
| `My-Event.json` | `params.script` | `My-Event-params.script.sh` |
| `Release-Pipeline.json` | `workflow.nt3sr3y4.params.script` | `Release-Pipeline-workflow.nt3sr3y4.params.script.sh` |

The general naming pattern is **`BASENAME-PROPERTY.EXT`**, in the same directory as `BASENAME.json`. Dot paths such as `params.script` identify nested properties. Setup chooses an extension from the executable command or a script's shebang when possible, falling back to JSON-looking content or `.txt`. Normal sync accepts your chosen extension.

The same `--file_props script,params.script` selection checks every node in a workflow automatically. If a node has a nonempty string at `data.params.script`, setup writes a neighbor for that node and leaves `(External)` in the workflow JSON. In its filename, `workflow.NODE_ID.params.script` identifies the node by its ID and then reads `data.params.script`. No additional option is needed for workflow nodes.

Use `--default_ext EXT` to replace the `.txt` fallback when setup cannot detect a type. For example, `--default_ext ps1` and `--default_ext .ps1` both produce `.ps1` neighbors. Detected interpreter and JSON extensions still take precedence. The fallback applies to every undetected property selected by that setup command, so group properties with the same expected file type or run setup separately when needed.

External properties are detected automatically when sync runs; you do not need to repeat `--file_props`. The neighbor's text replaces that property in the local definition before comparison and before an upload. A pull writes the latest value into the existing neighbor file.

You can use this for other string properties too, such as `body` or `notes`. Keep only one neighbor file per unique property path. A neighbor must resolve to a valid property path, and multiple matching neighbors are not treated as alternative versions.

Rename a definition and all its neighbors together. Do not delete an external file while leaving the placeholder `(External)` text as its saved value: the marker itself is ordinary text, and can be pushed as the property's content if no neighbor replaces it. To return to an inline property, put the real content back into the JSON and remove the neighbor.

### What sync compares and writes

Comparisons ignore auto-generated properties like `created`, `modified`, `revision`, `sort_order`, and `username`. Object key order does not create a change. Arrays and definition values remain meaningful, so changes to action lists, triggers, or parameters can produce updates.

Downsync writes pretty-printed XYPDF JSON and removes those server-maintained metadata fields. It keeps the existing local filename, even if the object's title changes in xyOps. Ordinary downsync does not extract new properties or invent new neighbor files; setup controls initial extraction.

## Run sync and review differences

### Push local changes

Edit an Event's JSON or external script, then preview:

```sh
xy sync ./ --up events,plugins,categories --dry
```

Remove `--dry` after reviewing it to actually perform the sync:

```sh
xy sync ./ --up events,plugins,categories
```

Updates use the resource API, so normal validation and permissions apply. Saved enabled schedules and actions remain active.

### Pull xyOps changes

This showcases running a sync in the oppostite direction, known as a "down sync".  This will only update existing local files -- it will not create new ones.

```sh
xy sync ./ --down events,plugins,categories --dry
xy sync ./ --down events,plugins,categories
```

Down-only mode replaces differing local definitions with the xyOps versions, including existing external properties, regardless of file modification times. Commit or otherwise preserve local edits you want to keep before pulling.

### Use full diffs

```sh
xy sync ./ --up events,plugins --dry --verbose
```

Normal output shortens unchanged diff context. `--verbose` shows full context and, for API operations, request and response details. A downsync preview also shows the XYPDF JSON that would be written.

`--dry` still connects, reads definitions, and scans files. It does not update xyOps, write local files, update sync tracking, run completion commands, or send error notifications.

### Understand scan failures

Sync scans and validates the sources before it begins updates or deletion. A missing base directory, malformed JSON or XYPDF source, unsupported item, missing ID, incompatible version, missing remote definition, duplicate source, or invalid neighbor stops that run before changes begin. This also applies to problematic XYPDF files whose type you did not select for a direction: the scan validates the entire tree first.

After changes begin, individual API or write failures are logged and the engine can continue with other objects.

## Configuration and option reference

### Save defaults in a CLI config file

Put a `sync` object in the machine configuration file for machine or service defaults, or the user configuration file for your own account. These are `/etc/xyops/cli.json` and `~/.config/xyops/cli.json` on Unix and macOS, or `%PROGRAMDATA%\xyops\cli.json` and `%USERPROFILE%\.config\xyops\cli.json` on Windows:

```json
{
	"base_url": "https://xyops.example.com",
	"api_key": "YOUR_API_KEY",
	"sync": {
		"up": ["events", "plugins", "categories"],
		"down": false,
		"delete": false,
		"cmd_timeout": 30,
		"error_email": "ops@example.com",
		"error_event": "SYNC_ERROR_EVENT_ID"
	}
}
```

Replace the URL, credentials, address, and Event ID with your own values; omit notification settings you do not want to use. With these defaults, `xy sync ./ --dry` previews the configured push.

CLI config loads the system file, then the user file, then `XYOPS_` environment variables. Matching top-level keys replace earlier values. A user-level `sync` object will replace a system-level `sync` object if both are present.

Use environment variables such as `XYOPS_BASE_URL` and `XYOPS_API_KEY` for connection credentials when appropriate.

### Override defaults for one run

Ordinary sync merges command-line options over the saved `sync` object. Top-level sync options replace their saved values:

```sh
xy sync ./ --up events --down false --delete false --dry
xy sync ./ --up false --down events,plugins --delete false --dry
xy sync ./ --up all --down all --delete false --dry
```

Use the literal `false` to disable a saved direction, deletion, or completion command. Lists can be JSON arrays or comma-separated strings; `all` and boolean `true` select all supported types. A command-line selection replaces the saved selection rather than adding to it.

### Change your saved user settings

`xy config` applies only the supplied changes to the user config file:

```sh
xy config --sync.up events,plugins --sync.down false --sync.delete false
xy config --sync.cmd_timeout 60
xy config --sync.error_email ops@example.com
xy config --sync.down_cmd "git add . && git commit -m 'Sync from xyOps'"
xy config --sync.lock_file /run/xyops/xycli-sync.pid
```

For nested arrays and other structured settings, editing the JSON config file directly is also convenient. Keep the complete desired `sync` object in the user file if you otherwise rely on system-level sync defaults.

### Directories and working directory

Specify one or more base directories to scan, followed by any switches you need:

```sh
xy sync /srv/xyops-sync --up events,plugins
```

You can optionally specify the base dirs in your config file as `base_dirs`.  This is used when no base directories are specified on the command-line.

```json
{
	"sync": {
		"base_dirs": ["/srv/xyops-sync"],
		"up": ["events", "plugins"],
		"down": false,
		"delete": false
	}
}
```

Relative paths resolve against the CLI's current working directory. Completion commands run in the first selected base directory.

### Common sync options

| Option | Config property | Default | Behavior |
| --- | --- | --- | --- |
| `--up TYPES` | `sync.up` | Disabled | Sync upwards to xyOps from local sources for these types. |
| `--down TYPES` | `sync.down` | Disabled | Down downwards to existing local sources from xyOps for these types. |
| `--delete TYPES` | `sync.delete` | Disabled | Delete remote objects with no local source. Use only in an up-only workflow; see [Delete mode](#delete-mode). |
| `--up_cmd COMMAND` | `sync.up_cmd` | None | Run a local shell command after at least one successful upsync. |
| `--down_cmd COMMAND` | `sync.down_cmd` | None | Run a local shell command after at least one successful downsync. |
| `--cmd_timeout SECONDS` | `sync.cmd_timeout` | `30` | Timeout for each completion command. |
| `--error_email ADDRESS` | `sync.error_email` | None | Email collected warnings and errors through xyOps. |
| `--error_event EVENT_ID` | `sync.error_event` | None | Launch an Event with collected warnings and errors in its input data. |
| `--lock_file PATH` | `sync.lock_file` | Temporary file keyed by `base_url` | Use an explicit path for the built-in PID lock. |
| `--dry` | n/a | Off | Dry-Run Mode: Preview without writes, completion commands, or notifications. |
| `--verbose`, `-v` | n/a | Off | Show complete diffs and additional request, response, and write details. |
| `--quiet`, `-q` | n/a | Off | Suppress routine output and progress. Fatal errors remain visible, but collected sync warnings and errors can be suppressed. |

At least one direction must be enabled. The command is a single run, not a background watcher; repeat it through a scheduler or hook for automatic operation.

`--format json` and `--format jsonc` affect JSON values printed by shared helpers, such as API previews. `--raw` outputs raw IDs instead of friendly labels. See [Global CLI switches](../README.md#global-cli-switches).

### Setup options

| Option | Behavior |
| --- | --- |
| `xy sync setup TYPES...` | Export the selected types to the current directory. Separate type names with spaces, or use `all`. |
| `--setup TYPES` | Alternative setup syntax, accepting comma-separated type names. For example, `xy sync --setup events,plugins`. |
| `--file_props PATHS` | Extract string properties into adjacent neighbor files. Accepts comma-separated dot paths or a JSON array. |
| `--default_ext EXT` | Use this extension instead of `txt` when a neighbor's type cannot be detected. A leading dot is optional. |
| `--new` | Export only remote definitions whose type and ID are not already present in the current local tree. |
| `--down_cmd COMMAND` | Run a local shell command after setup writes one or more definitions. |
| `--cmd_timeout SECONDS` | Set the setup completion-command timeout in seconds. The default is `30`. |
| `--stock` | Include stock definitions that ships wit xyOps (e.g. "Shell Plugin"), which setup normally omits. |
| `--marketplace` | Include Marketplace Plugins, which setup normally omits. |
| `--force` | Allow generated files to overwrite existing destinations. |
| `--dry` | Preview setup's output without creating folders or files. |

Workflow defaults in the `sync` configuration object are not used by setup. Pass setup choices explicitly on the command line. An explicitly supplied `down_cmd` runs from the current setup directory only after real files are written, so it does not run during a dry run or when `--new` finds nothing. The common `lock_file` setting still applies so setup cannot overlap another sync operation for the same instance.

## Two-way sync and modification times

Enable both directions for the same resource type:

```sh
xy sync ./ --up events,plugins --down events,plugins --delete false --dry
```

For each differing definition, the engine compares xyOps's `modified` timestamp with the local source's filesystem modification time. The effective local time is the newest timestamp among the JSON definition and all its external property files.

- If xyOps's timestamp is newer, the definition is pulled down.
- Otherwise, the local definition is pushed up. Equal timestamps favor the local source.
- If the definitions are identical after ignoring server-maintained metadata, nothing is written.

Two-way sync is experimental. Keep clocks synchronized, review dry runs, and preserve a history of both configuration and scripts. Git checkout, clone, restore, or file copying can give old content a new filesystem timestamp.

Bucket data and files use their own modification times, separate from the Bucket definition. When contents differ, two-way sync compares `data.json` with the data record's modification time and each local file with the matching manifest date. Equal timestamps with differing Bucket content are reported as conflicts. After a transfer, xyCLI sets the local modification time to the server's returned time.

Bucket file comparison uses size and modification time because the manifest has no content hash. A same-size change with an unchanged timestamp cannot be detected.

For automatic two-way operation, use a persistent tree and run every minute. Both directions are considered on each run; you do not need separate alternating up and down jobs. Newly created definitions still need a setup export or individual local source.

### Remove a definition during two-way sync

Two-way sync does not propagate deletions. Definition deletions are usually infrequent, so coordinating them manually is generally practical. Keep `--delete false` in the scheduled command, and remove a definition from both sides deliberately:

1. Delete the definition in the xyOps web interface first.
2. Remove its local XYPDF JSON file and any neighboring external property files. If the tree is stored in Git, commit and push their removal so the dedicated sync checkout receives the deletion.
3. Run sync again, or resume the schedule, after the local files are gone. Pause the schedule during these steps if you want to avoid a failed pass between the two removals.

If a sync runs after the xyOps deletion but before local cleanup, the leftover source produces a missing-object warning. The run exits with a failure status before updating or downloading any definitions, and a script that stops on failure will not reach a following `sync setup --new` step. The deleted definition is not recreated. Remove the stale files and retry.

Do not remove the Git files first while the definition still exists in xyOps. A scheduled `sync setup --new` pass can export the still-existing definition back into the repository. See the [Two-Way Git Sync Tutorial](two-way-git-tutorial.md#delete-a-definition-from-both-sides) for the Git workflow.

## Remote-management warnings

Up-only sync records the managed definitions in xyOps's global sync state. The web interface and xyCLI update commands use this information to warn that a definition is under remote management and should not be edited directly.

When an applicable `xy TYPE update` command finds this flag, it displays a yellow warning and stops before sending the update. Add `--confirm` to override the warning for that command. This is an advisory safeguard rather than a permission lock, and it does not change the saved sync state. A later upsync can overwrite the confirmed change with the local definition.

Only types configured for upsync without downsync receive that warning. A down-only run clears the remote-management map; a two-way run omits its two-way definitions. Mixed-direction runs mark only their up-only definitions. Dry runs leave the map unchanged, and an identical map is not rewritten.

Each run publishes its own complete state map rather than merging it with earlier runs.

To clear every remote-management flag manually, run:

```sh
xy system reset sync --confirm
```

This resets only the global sync state map. It does not change xyOps definitions, local files, or saved sync settings. The next up-only sync publishes a new map for the definitions it manages.

Make sure only one sync instance talks to one xyOps installation.

## Delete mode

Delete mode treats missing local definitions as a request to delete them **in xyOps**. Use it exclusively with an up-only source of truth. It is not a way to clean local files during downsync, and it does not provide two-way deletion propagation.

### Prepare a complete inventory

The scanned directories must contain a source for **every other remote object of each type selected for deletion** that you intend to keep. Delete mode considers all eligible objects in the visible remote collection, not just objects previously synced or carrying a remote-management warning.

**Side-Note:** Any items marked as "stock" or "marketplace" in xyOps are omitted from deletion candidates.

Export a fresh inventory with an API Key that can see the entire selection:

```sh
mkdir xyops-delete-inventory
cd xyops-delete-inventory
xy sync setup events plugins categories
```

Verify that every object eligible for deletion that you intend to keep has a corresponding source, including workflows under the `events` selection. Stock and Marketplace objects may be omitted. Avoid filename collisions, omitted resources, missing mounts, and hidden source directories.

### Preview a deliberate deletion

Remove the source file(s) for the Event you intend to delete, then preview from the complete inventory:

```sh
xy sync ./ --up events,plugins,categories --down false --delete events --dry
```

Inspect the entire deletion list and confirm that the directory and remote inventory are still complete. Apply only after that review:

```sh
xy sync ./ --up events,plugins,categories --down false --delete events
```

Deleting an Event does not automatically remove its dependencies. Remote API rules still apply, including restrictions on active jobs and references.

Deletion only begins after every update has completed and the sync-tracking state has been written without warnings or errors. If either phase fails, the entire delete pass is skipped for that run. Earlier successful updates remain in place, so correct the error and retry; definitions already updated will compare equal. Once deletion begins, successful earlier deletions are not rolled back if a later deletion fails.

With `--delete buckets`, a remote Bucket file missing from a selected local Bucket's `files/` directory is deleted individually. Removing the Bucket XYPDF source deletes the whole Bucket, including all its data and files. A missing or invalid `data.json`, incomplete file inventory, or failed transfer prevents Bucket file deletion and the whole-object delete pass.

An unavailable base directory stops the scan, but an existing empty directory can look like an empty inventory. Do not treat that guard as protection against an empty mount, accidental file removal, or missing exports of your own definitions.

Keep deletion disabled in general-purpose cron, Git hooks, and CI until you have a deliberate policy for maintaining and checking the complete inventory. Disable saved deletion for other runs with `--delete false`.

It is also highly recommended that you [keep daily backups of critical data](https://docs.xyops.io/hosting/daily-backups) before enabling sync, especially sync with delete.

## Completion commands

Completion commands connect sync with your local workflow. For example, run a validation script after uploads, or commit changed files after downloads:

```sh
xy sync ./ --up events,plugins --up_cmd "./after-upload.sh"
xy sync ./ --down events,plugins --down_cmd "git add . && git commit -m 'Sync from xyOps'"
```

They run in a local shell, in the first specified base sync directory, using the CLI process's environment. Each command has its own timeout, defaulting to 30 seconds:

```sh
xy sync ./ --down events,plugins --down_cmd "./commit-downloads.sh" --cmd_timeout 60
```

### When commands run

- `up_cmd` runs if at least one object was successfully upsynced (this includes deletes).
- `down_cmd` runs if at least one object was successfully downsynced.
- During setup, an explicitly supplied `down_cmd` runs if at least one definition was written.
- If both apply, `up_cmd` runs first, then `down_cmd`.
- Neither runs for an identical/no-op run, a scan that stopped before changes, or a dry run.
- A completion command can run after partial success even if another item failed. It is not proof that the whole run succeeded.

Command output is displayed when not quiet. Command failures are collected as sync errors; captured failed-command stdout and stderr may also print even in quiet mode. Notifications run after completion commands, so they can report those command failures too.

### Commit downloads without recursive sync

For a dedicated automation repository, create `commit-downloads.sh` in its root:

```sh
#!/bin/sh
set -eu

# Stage changes in this dedicated definition repository.
git add .

# A download need not produce a Git content change, so avoid empty commits.
if git diff --cached --quiet; then
	exit 0
fi

# Skip Git hooks for this generated commit to avoid reentering sync.
git -c core.hooksPath=/dev/null commit -m "Sync from xyOps"
```

Make it executable and configure it:

```sh
chmod +x ./commit-downloads.sh
xy config --sync.down_cmd "./commit-downloads.sh"
```

The repository needs a configured Git author identity. Keep unrelated changes and staged work out of this dedicated checkout; `git add .` includes everything below its current directory. For a shared repository, adjust the script to stage only your definition tree and avoid committing unrelated staged files.

The example commits locally. Add a push only when your automation account has the necessary credentials and you have chosen how those commits should enter the remote branch.

## Error notifications

Use notifications to make unattended runs observable, particularly when using `--quiet`:

```sh
xy sync ./ --up events,plugins --delete false \
	--error_email ops@example.com --error_event SYNC_ERROR_EVENT_ID
```

Both options respond to collected **warnings as well as errors**. A no-op run with no warnings sends nothing. Dry runs send no notifications, even if the scan reports problems.

### Email reports

`error_email` calls xyOps's email API. The conductor must have working mail configuration, and the API Key needs the `send_emails` privilege.

The report includes warnings, errors, date, host, platform, CLI version, command line, and effective sync settings. Prefer CLI config files or environment variables for connection credentials rather than putting secrets directly in command arguments or completion commands that may appear in reports.

### Error Events

`error_event` launches an existing Event by exact ID. Configure it with an enabled manual trigger and give the sync key permission to run it. It might notify a Channel, open a Ticket, or run your own recovery script.

The Event receives the following input data:

```json
{
	"input": {
		"data": {
			"errors": ["Example sync error"],
			"warnings": ["Example source warning"]
		}
	}
}
```

These arrays are available to the job as `input.data.errors` and `input.data.warnings`. Both can be empty individually, but at least one has entries when the notification Event is launched.

Keep the notification Event independent of the broken sync process. An Event that repeatedly invokes the same failing sync can create a notification loop.

### What notifications cannot catch

Notifications use the same xyOps connection and API Key as sync. Missing credentials, startup failures, invalid direction settings, or an unreachable API may fail before the engine can collect and deliver a report. If email delivery fails, the current run aborts before attempting a subsequent `error_event` notification. Use external monitoring too when you need to detect failures of xyOps itself.

### Exit status

Sync exits with status `1` if any sync warning or error occurs, including duplicate-source warnings, other scan warnings, and scan, API, file-write, tracking-state, or completion-command errors. This also applies in quiet mode and during a dry run. Setting the failure status does not interrupt the remaining completion commands or notifications; they can finish before the process exits. Fatal CLI errors also exit nonzero.

Runs with no warnings or errors exit with status `0`. Scan warnings prevent changes from being applied, so a warning-only run also reports failure. Both warnings and errors can trigger the configured notifications. Check the exit status in scripts, review reports, and verify remote definitions after critical deployments.

## Built-in PID locking

Every `xy sync` command acquires a host-local PID lock before it loads remote definitions or touches local files. This includes ordinary up, down, two-way, delete, dry-run, and setup operations. The lock remains held through completion commands and error notifications, so every CLI entry point uses the same overlap protection automatically.

By default, xyCLI creates a lock file in the operating system's temporary directory. Its filename contains a hash of the normalized `base_url`, so syncs targeting the same xyOps instance on one host serialize even when they use different directories or API Keys. Syncs for different instances use different default locks.

When another live sync process owns the lock, the new command stops before doing any work, prints the owning PID and lock path, and exits nonzero. It does not wait or queue. Schedulers can try again on their next run. If a process was forcibly terminated and left its PID file behind, the next invocation detects that the PID is dead, removes the stale file, atomically acquires a replacement, and continues.

The lock contains its PID, start time, base URL, and a random ownership token. Normal completion and process-exit handlers remove it only when the token still matches, preventing an older process from deleting a newer lock.

### Choose an explicit lock path

For a service account, set a stable absolute path in the CLI config:

```json
{
	"sync": {
		"lock_file": "/run/xyops/xycli-sync.pid"
	}
}
```

Create the parent directory ahead of time and give the sync account permission to create and remove the file. You can override the saved path for one run:

```sh
xy sync /srv/xyops-sync --up all --lock_file /run/xyops/xycli-sync.pid
```

Prefer one service account for automatic sync. If multiple local accounts target the same instance, give them the same explicit path and ensure each can read the file and modify its parent directory. A PID lock coordinates processes only on one operating-system host. If multiple hosts can run sync against the same instance, arrange for only one host to do so or use a distributed scheduler; a shared PID file cannot reliably identify processes on another host.

## Automatic sync with cron

Cron is a good fit for a persistent sync tree. Each invocation makes one pass and exits. Running every minute lets the next pass pick up changes made since the previous run. For automatic two-way sync, use a cron job from the account and host that own the persistent working tree.

### Prepare the account and paths

Run the command manually as the same operating-system account that will run cron. That account needs its own CLI configuration, access to the tree, and a working Node.js installation. A download also needs write access. If `down_cmd` commits files, configure Git's author name and email for that account too.

Locate the executables:

```sh
command -v xy
command -v node
```

The examples below assume `xy` is `/usr/local/bin/xy` and Node.js is on the shown `PATH`. Adjust these for your installation. Node version managers often install outside this path. Even an absolute path to `xy` still needs a suitable `PATH` for its Node.js interpreter. The built-in PID lock supplies overlap protection, so no external locking command is required.

### Up-only cron job

Use `crontab -e` for the intended account and add:

```cron
PATH=/usr/local/bin:/usr/bin:/bin

# Send local changes to xyOps every minute.
* * * * * /usr/local/bin/xy sync /srv/xyops-sync --up events,plugins,categories --down false --delete false --quiet --error_email ops@example.com
```

Choose only the item types your tree manages. This example explicitly disables downsync and deletion. Add `--error_event EVENT_ID` if you prefer an error-handling Event, or configure notifications in the account's CLI config file.

`--quiet` keeps routine progress and diffs out of cron's output, avoiding an email for every ordinary run. Fatal CLI errors still print to standard error. Collected sync warnings and errors can be suppressed, so quiet automation should have configured notifications and external monitoring. Remove `--quiet` while investigating a problem.

If the previous run is still active, the built-in PID lock rejects the overlapping invocation with a nonzero exit status. The next minute tries again. A single sync can therefore take longer than a minute without starting another copy.

### Two-way cron job

For a persistent working tree where both sides may be edited, replace the previous entry with:

```cron
PATH=/usr/local/bin:/usr/bin:/bin

# Every pass checks both directions. Never enable deletion here.
* * * * * /usr/local/bin/xy sync /srv/xyops-sync --up all --down all --delete false --quiet --error_email ops@example.com
```

Each run compares the current local sources with xyOps and chooses a direction for each changed object using [modification times](#two-way-sync-and-modification-times). `all` still operates only on definitions with existing local sources. It does not discover new objects.

Configure a `down_cmd`, such as the [commit-downloads script](#commit-downloads-without-recursive-sync), to record web-interface changes in Git after downloads. Use a persistent clone, synchronized clocks, and one writer at a time. Avoid periodically replacing this tree with a fresh Git checkout, which changes timestamps and can change conflict decisions.

These examples use a **user crontab**, with five time fields followed by the command. `/etc/crontab` and `/etc/cron.d` entries need an additional account field. Cron has a limited environment; see the [crontab manual](https://man7.org/linux/man-pages/man5/crontab.5.html) for its environment and syntax.

## Automatic upsync with Git hooks

Git hooks let local repository operations trigger a sync operation on certain actions. They execute on the machine performing the command, using that person's CLI credentials. Hooks are not automatically installed when somebody clones a repository.

The examples assume definitions live in an `automation/` subdirectory of the repository. They deploy existing definitions from the **working tree**, not Git's staging area or an arbitrary commit. Keep that directory clean before deploying so uncommitted edits do not become part of an ostensibly committed release.

Create a tracked hooks directory and enable it in each clone that should deploy:

```sh
mkdir -p .githooks
git config core.hooksPath .githooks
```

Save the selected script under the hook filename shown below and make it executable. Choose a deployment trigger rather than installing every example at once. The built-in PID lock prevents these hooks from overlapping another local sync for the same xyOps instance.

All examples disable saved deletion, downloads, and completion commands. Disabling completion commands avoids a sync command launching another Git operation that triggers the same deployment hook. Credentials belong in the user's CLI config or environment, not a tracked hook script.

### Deploy after a commit on the main branch

Save as `.githooks/post-commit`:

```sh
#!/bin/sh
set -eu

# Only this clone's main branch deploys.
[ "$(git symbolic-ref --quiet --short HEAD)" = main ] || exit 0
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

# A partial commit must not deploy leftover working-tree changes.
if [ -n "$(git status --porcelain -- automation)" ]; then
	echo "Sync skipped: automation/ has uncommitted changes." >&2
	exit 1
fi

xy sync "$repo_root/automation" --up events,plugins,categories \
	--down false --delete false --up_cmd false --down_cmd false \
	--error_email ops@example.com
```

```sh
chmod +x .githooks/post-commit
```

This runs after each commit on `main`, including commits that do not change automation; identical definitions are skipped. A post-commit hook cannot undo the commit if deployment fails. Check the output and notification reports before considering the deployment complete.

### Deploy before pushing the main branch

Use `.githooks/pre-push` when you want a push to trigger sync. Git passes proposed ref updates on standard input:

```sh
#!/bin/sh
set -eu

deploy=false
while read -r local_ref local_oid remote_ref remote_oid; do
	# Ignore deletions and unrelated branches.
	if [ "$remote_ref" = refs/heads/main ] && [ "$local_ref" != '(delete)' ]; then
		# Sync reads the checked-out tree, so require the pushed commit to be HEAD.
		if [ "$local_oid" != "$(git rev-parse HEAD)" ]; then
			echo "Check out the commit being pushed before syncing." >&2
			exit 1
		fi
		deploy=true
	fi
done

[ "$deploy" = true ] || exit 0
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
if [ -n "$(git status --porcelain -- automation)" ]; then
	echo "Sync skipped: automation/ has uncommitted changes." >&2
	exit 1
fi

xy sync "$repo_root/automation" --up events,plugins,categories \
	--down false --delete false --up_cmd false --down_cmd false \
	--error_email ops@example.com
```

Make sure to make the hook script executable:

```sh
chmod +x .githooks/pre-push
```

This deployment happens **before** Git sends the push. A later rejected push does not roll back xyOps changes. A sync warning or error makes the hook exit nonzero and aborts the push. Review notification reports too. See [Exit status](#exit-status).

### Deploy when pushing a release tag

Git has no separate tag-push hook. Use `pre-push` and inspect the refs. To deploy only tags named `v*`, replace the preceding hook with:

```sh
#!/bin/sh
set -eu

deploy=false
while read -r local_ref local_oid remote_ref remote_oid; do
	[ "$local_ref" != '(delete)' ] || continue
	case "$remote_ref" in
		refs/tags/v*)
			# Peel annotated tags and require their commit to be checked out.
			tag_commit=$(git rev-parse "$local_oid^{commit}")
			if [ "$tag_commit" != "$(git rev-parse HEAD)" ]; then
				echo "Check out the tagged commit before syncing." >&2
				exit 1
			fi
			deploy=true
			;;
	esac
done

[ "$deploy" = true ] || exit 0
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
if [ -n "$(git status --porcelain -- automation)" ]; then
	echo "Sync skipped: automation/ has uncommitted changes." >&2
	exit 1
fi

xy sync "$repo_root/automation" --up events,plugins,categories \
	--down false --delete false --up_cmd false --down_cmd false \
	--error_email ops@example.com
```

Multiple matching tags pushed together cause one sync of the checked-out tree. If the release should deploy only after the remote repository accepts the tag, use the GitHub Actions workflow below instead.

For hook arguments, execution context, and `core.hooksPath`, see the [Git hooks reference](https://git-scm.com/docs/githooks).

## Automatic upsync with GitHub Actions

GitHub Actions can deploy a committed tree from a clean checkout. Use up-only sync: timestamps in a fresh runner checkout should not decide two-way conflicts.

### Add repository secrets

In the repository, open **Settings > Secrets and variables > Actions** and add these repository secrets:

| Secret | Value |
| --- | --- |
| `XYOPS_BASE_URL` | Your xyOps base URL, such as `https://xyops.example.com`. |
| `XYOPS_API_KEY` | An API Key with the required read, edit, and `update_state` privileges. |

The runner needs network access to xyOps. For a private endpoint, use a suitably connected self-hosted runner or your established private-network access method. See GitHub's [repository secrets guide](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

### Deploy pushes to main

Save this as `.github/workflows/xyops-sync.yml`:

```yaml
name: Sync xyOps automation

on:
  push:
    branches: [main]
    paths:
      - 'automation/**'
      - '.github/workflows/xyops-sync.yml'
  workflow_dispatch:

permissions:
  contents: read

# Serialize deployments from this repository to this xyOps environment.
concurrency:
  group: xyops-production-sync
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    env:
      XYOPS_BASE_URL: ${{ secrets.XYOPS_BASE_URL }}
      XYOPS_API_KEY: ${{ secrets.XYOPS_API_KEY }}
    steps:
      - name: Check out the committed definitions
        uses: actions/checkout@v7

      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: '24'

      - name: Install xyCLI
        run: npm install --global @pixlcore/xycli

      - name: Check connection settings
        run: |
          : "${XYOPS_BASE_URL:?Set the XYOPS_BASE_URL repository secret}"
          : "${XYOPS_API_KEY:?Set the XYOPS_API_KEY repository secret}"

      - name: Apply changes
        run: |
          xy sync "$GITHUB_WORKSPACE/automation" \
            --up events,plugins,categories --down false --delete false \
            --up_cmd false --down_cmd false --error_email "ops-oncall@yourcompany.com"
```

Choose resource types that match your tree. Pin the xyCLI installation to a version you have validated, for example `npm install --global @pixlcore/xycli@YOUR_TESTED_VERSION`, when you want reproducible deployments. The examples use the official [checkout](https://github.com/actions/checkout) and [setup-node](https://github.com/actions/setup-node) actions; use versions compatible with your runner.

Leave routine output enabled in CI so its logs contain diffs and progress. Sync warnings and errors produce a nonzero exit status and fail the workflow step. Review notifications and logs to resolve the problem, and verify critical definitions after deployment.

### Deploy accepted release tags instead

To trigger the same job only when GitHub accepts a release tag, replace the workflow's `on` section with:

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
```

The checkout action checks out the triggering tag. This workflow does not require the person pushing it to have CLI credentials locally. Choose branch or tag deployment deliberately; enabling both can deploy the same release twice.

Repository concurrency controls these workflow runs. Coordinate all writers to the same environment. See [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) for triggers, permissions, and concurrency.

## Troubleshooting and operational limits

| Symptom | What to check |
| --- | --- |
| Sync says to enable a direction | Set `--up`, `--down`, or saved defaults. Setup and ordinary sync are different operations. |
| The wrong directory is scanned | Positional paths take precedence, followed by `base_dirs`, then the current directory. Check your command and config; use absolute paths in automation. |
| A config override seems to vanish | The user file replaces a system `sync` object as a whole. Environment settings take precedence over files. See [configuration](#configuration-and-option-reference). |
| An object is missing from the local tree | Ordinary downsync does not discover it. Export that object or run setup in a separate staging directory. |
| A source cannot find its remote object | Match its exact `type` and `data.id` to an existing visible object in this xyOps installation. Create/import missing objects separately. |
| A duplicate-source warning stops sync | Keep one file per resource type and ID, even when the copies are identical. Remove duplicates and avoid overlapping base directories, then retry. |
| One bad file stops unrelated updates | The scan validates all JSON sources before applying changes. Fix malformed JSON, multi-item XYPDF, unsupported types, missing objects, or unreadable property files. |
| A script edit has no effect | Check the matching JSON stem, property suffix, filename extension, and property path. Hidden paths are skipped. |
| Two-way sync overwrites an unexpected side | Compare the remote modification time with the newest JSON/property-file mtime. Fresh checkouts, clock skew, or touched files can make local sources appear newer. |
| An Event or workflow does not execute | Sync saves definitions; it does not run them. Use `xy run EVENT_ID` separately. |
| `down_cmd` does not run | Normal sync requires a successful download. Setup requires at least one written definition and an explicit `--down_cmd`. No-op and dry runs do not trigger it. |
| A download commit launches another sync | Disable deployment Git hooks for commits made by `down_cmd`. The nested sync will otherwise be rejected by the built-in PID lock. |
| Sync reports another PID is running | Another local sync owns the lock. Let it finish. If the PID is no longer alive, the next run recovers the stale file automatically. If the PID belongs to an unrelated recycled process, verify that no sync is active before removing the reported lock file. |
| A scheduled run prints nothing | `--quiet` suppresses routine output and collected reports. Remove it to investigate and configure notifications. |
| Sync exits nonzero after a warning report | Scan warnings prevent changes from being applied, so warnings and errors both exit with status `1`. Resolve the reported problem before retrying. |
| Notifications never arrive | Check API access, email setup and privileges, the error Event's manual trigger, and failures occurring before reporting. |
| API Key updates behave differently after import | Portable definitions do not transfer usable secret key material. Treat key credentials separately from their definitions. |

### Plan for partial success

Sync is not a transaction. A scan warning prevents the apply phase, but an API or filesystem failure during application can leave earlier changes in place. Completion commands may run for those successful changes. Individual file writes are atomic, but a definition and its external property files are not a single atomic group.

Before important deployments, review a dry run, retain recoverable versions of both sides, and coordinate writers. After a failure, fix the reported problem, inspect both sides, and run another preview before retrying.

### Keep the inventory deliberate

Sync uses IDs rather than titles or filenames, and does not remap IDs for a different xyOps installation. Duplicate sources for the same type and ID generate warnings and stop the run before changes; keep one source per object and avoid overlapping base directories. Split inventories by ownership when useful, but remember that each run replaces the shared up-only remote-management tracking map rather than combining independent jobs' maps.

New remote objects, objects removed remotely, filename changes, and dependency ordering need explicit maintenance. Deletion remains an up-only workflow with a complete inventory. Two-way sync remains experimental and resolves whole objects by modification time, without a merge or conflict prompt.

- **Command reference:** [Sync](help.md#sync), [Sync setup](help.md#sync-setup), [Exports](help.md#export), [Imports](help.md#import), and [Run](help.md#run).
- **Learn more about xyOps:** [xyOps Portable Data Format](https://docs.xyops.io/xypdf) and [xyOps API Keys](https://docs.xyops.io/api#api-keys).
