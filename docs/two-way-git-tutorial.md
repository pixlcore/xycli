# Two-Way Git Sync Tutorial

> [!IMPORTANT]
> Some of the features used in this tutorial require xyCLI v1.0.2 or newer.

This tutorial sets up one persistent Git checkout as the bridge between xyOps and a shared repository. Team members can edit and push Event files through Git, while changes made in the xyOps web interface are downloaded, committed, and pushed back to the repository.

The finished workflow looks like this:

```text
Developers <-> Git repository <-> Dedicated sync checkout <-> xyOps
```

One machine and operating-system account should own the dedicated sync checkout. That machine can be an xyOps worker running xySat, but xySat is not required. Cron, another scheduler, or a manually launched script works too.

This tutorial manages Events and workflows. You can expand the commands to other [supported resource types](sync.md#supported-resources-and-requirements) after the Event flow is working.

## Before you begin

You will need:

- xyCLI installed and connected to xyOps.
- A dedicated Git repository and a persistent clone on the sync machine.
- A xyOps API Key that can read and edit Events and update the global sync state.
- Git credentials that allow the sync account to pull and push without an interactive prompt.
- A configured Git author name and email for automated commits.
- Accurate clocks on the sync machine and the xyOps conductor, preferably synchronized through NTP.
- The `flock` command on the scheduler host if you plan to use cron.

Two-way sync is experimental. When the local and remote definitions differ, xyCLI compares the xyOps modification timestamp with the newest modification time among the local JSON file and its external property files. The newer side wins, and equal timestamps favor the local copy.

Do not periodically replace the dedicated checkout with a fresh clone. Git checkout operations can change filesystem timestamps, which are part of two-way conflict resolution.

## 1. Prepare the dedicated checkout

Clone the repository into a permanent location. Replace the example URL and path with your own:

```sh
git clone git@github.com:YOUR_ORG/xyops-automation.git /srv/xyops-automation
cd /srv/xyops-automation
```

Configure the identity used for commits created by sync:

```sh
git config user.name "xyOps Sync"
git config user.email "xyops-sync@example.com"
```

Run all remaining setup commands as the same operating-system account that will run the scheduled job. Configure xyCLI for that account if you have not already done so:

```sh
xy config --base_url https://xyops.example.com --api_key YOUR_API_KEY
xy dashboard
```

The dashboard command verifies the connection. Keep the API Key and Git credentials out of the repository.

## 2. Export the initial Event tree

Preview the initial setup from the repository root:

```sh
cd /srv/xyops-automation
xy sync setup events --file_props script,params.script --default_ext ps1 --dry
```

The `events` selection includes both Events and workflows. Setup places workflows in their own `workflows/` directory, then groups Events and workflows into subfolders named after their Categories.

`--file_props script,params.script` extracts common script properties into neighboring files. It also checks each workflow node automatically, so a node's `data.params.script` gets its own file named with that node's ID. If a property uses another path, add its dot path to the list. For example, use `script,params.script,params.command` when an Event stores its PowerShell source in `params.command`.

The optional `--default_ext ps1` uses `.ps1` when setup cannot detect a neighbor file's language from an executable command, shebang, or JSON content. Remove it or choose another extension if PowerShell is not the appropriate fallback for your repository.

When the preview looks correct, write the files:

```sh
xy sync setup events --file_props script,params.script --default_ext ps1
```

Review the generated files before publishing them. Definitions can contain scripts, request headers, and other sensitive configuration.

```sh
git status --short
find events workflows -type f -print 2>/dev/null
```

Commit and push the initial tree:

```sh
git add --all
git commit -m "Add xyOps Event definitions"
git push -u origin HEAD
```

Setup is only responsible for creating the local source files. Normal sync identifies each definition by its resource type and exact ID inside the JSON, so you may reorganize or rename the generated files afterward.

## 3. Preview two-way sync

Run a dry pass before enabling automation:

```sh
xy sync . --up events --down events --delete false --dry
```

This considers both directions for every local Event and workflow source:

- A newer local file is uploaded to its existing xyOps definition.
- A newer xyOps definition is downloaded to its existing local file.
- Identical definitions are left alone.

The `--delete false` switch is intentional. Two-way sync does not propagate deletions. Keep deletion disabled in the scheduled command, and follow the [coordinated deletion steps](#delete-a-definition-from-both-sides) when retiring an item.

Review the displayed diffs carefully. If the wrong side would win, check the clocks and file modification times before continuing.

## 4. Create the scheduled sync script

Save the following script as `/usr/local/sbin/xyops-git-sync`. Adjust `PATH`, `REPO_DIR`, `XY_BIN`, the extracted property list, and the fallback extension for your environment.

```sh
#!/bin/sh
set -eu

# Cron and xySat jobs often receive a minimal environment. Include the
# directories containing Node.js, xyCLI, Git, and standard system tools.
PATH="/usr/local/bin:/usr/bin:/bin"
export PATH

REPO_DIR="/srv/xyops-automation"
XY_BIN="/usr/local/bin/xy"

cd "$REPO_DIR"

# This should be a dedicated automated checkout. Stop instead of accidentally
# committing an operator's unfinished work or leftovers from a failed run.
if [ -n "$(git status --porcelain)" ]; then
	echo "The sync checkout has uncommitted changes. Resolve them before retrying."
	exit 1
fi

# Bring in changes pushed by contributors. The extra push retries a commit
# that may have succeeded during an earlier run whose network push then failed.
git pull --quiet --ff-only
git push --quiet

# xyCLI runs this only after it writes local definitions.
GIT_DOWN_CMD="git add --all && git commit -m 'Sync from xyOps' && git push"

# Sync changes to existing local definitions in both directions. If this
# command fails, set -e stops the script before the setup pass.
"$XY_BIN" sync . \
	--up events \
	--down events \
	--delete false \
	--down_cmd "$GIT_DOWN_CMD" \
	--cmd_timeout 120

# Discover definitions created in xyOps since the initial setup. Existing
# sources are identified by type and ID, regardless of their paths or names.
# The setup completion command runs only when new files were actually written.
"$XY_BIN" sync setup events \
	--new \
	--file_props script,params.script \
	--default_ext ps1 \
	--down_cmd "$GIT_DOWN_CMD" \
	--cmd_timeout 120
```

Make the script executable:

```sh
chmod 755 /usr/local/sbin/xyops-git-sync
```

Run it manually as the eventual scheduler account before installing a schedule:

```sh
/usr/local/sbin/xyops-git-sync
```

The script intentionally does not implement its own outer lock. A cron caller will use `flock` to protect the complete pull, normal sync, and new-definition setup sequence. When xyOps schedules the script through xySat, the Event's job concurrency setting provides this protection instead. xyCLI's built-in lock still protects each individual sync command.

The two uses of `--down_cmd` are deliberately identical:

- Ordinary sync runs it only after at least one existing definition is successfully downloaded.
- `sync setup --new` runs it only after at least one new local definition is written.
- A no-op or dry run does not create a commit or push.

The command stages the entire dedicated repository with `git add --all`. Do not use this script in a checkout containing unrelated work. If your repository contains other material, narrow the Git paths in `GIT_DOWN_CMD`.

## 5. Schedule the script with cron

Open the crontab for the sync account:

```sh
crontab -e
```

Locate `flock` and adjust the path in the cron entry if necessary:

```sh
command -v flock
```

Run the script every minute, with `flock` outside the script:

```cron
* * * * * /usr/bin/flock --nonblock --conflict-exit-code 0 /tmp/xyops-git-sync.lock /usr/local/sbin/xyops-git-sync >/dev/null
```

Cron normally emails job output when local mail delivery is configured. This entry discards routine standard output so successful runs remain silent, but leaves standard error alone so failures can still trigger mail. The xyCLI commands deliberately omit `--quiet`, because that option can suppress collected sync warnings and error reports along with routine output.

To keep successful output in a log instead, replace `>/dev/null` with an append redirect to a file that the sync account can write. Do not place that log inside the Git repository because the completion command stages the whole tree.

`--nonblock` makes an overlapping invocation exit immediately instead of waiting. `--conflict-exit-code 0` treats that expected skip as a successful scheduler run, while an executed sync script still returns its own exit status. The operating system releases the advisory lock automatically when `flock` exits, including when the sync script fails. The `/tmp/xyops-git-sync.lock` file may remain afterward, which is normal and does not mean the lock is still held. See the [`flock` manual](https://man7.org/linux/man-pages/man1/flock.1.html) for details.

## 6. Or schedule it through xySat

On a machine running xySat, create an Event using the Shell Plugin and target only the dedicated sync worker. Give it a recurring one-minute schedule and use this script body:

```sh
/usr/local/sbin/xyops-git-sync
```

Keep the Event's [job concurrency setting](https://docs.xyops.io/#Docs/limits/max-jobs-limit) at `1`, which is the default. xyOps will then prevent a second copy of the Event from running while the first job is still active, so this invocation does not need `flock`.

The xySat service account must be able to execute the script, read and write the repository, run Node.js and xyCLI, access that account's xyCLI configuration, and use the Git credentials. Test the Event manually before enabling its schedule.

Schedule only one copy of this workflow, and do not run both cron and xySat for the same checkout.

## 7. Understand the daily workflow

After setup, contributors work through Git as usual:

```sh
git pull
# Edit Event JSON or neighboring script files.
git add --all
git commit -m "Update nightly report"
git push
```

The next scheduled pass pulls the commit and uploads newer local definitions to xyOps. If someone edits an existing Event in the xyOps web interface, the next pass downloads the newer definition, and `--down_cmd` commits and pushes the changed files.

When someone creates a new Event in xyOps, the ordinary sync pass does not know where to create its local source. The following `sync setup events --new` pass discovers it, creates the suggested files in its Category folder, then commits and pushes them through its own `--down_cmd`.

`--new` is additive. It does not overwrite existing sources, and it matches existing definitions by type and exact ID rather than filename. This preserves renamed files and custom folder layouts.

### Delete a definition from both sides

Event and workflow deletions are usually infrequent, so it is practical to coordinate the xyOps and Git changes manually. Pause the scheduled script if you want to avoid a failed pass while you make both changes:

1. Delete the definition in the xyOps web interface first.
2. Remove its XYPDF JSON file and all neighboring property files from Git, then commit and push the deletion. Make sure the dedicated sync checkout receives that commit before its next sync pass.
3. Resume the scheduled script and check its next run.

If the script runs after the xyOps deletion but before the Git deletion reaches its checkout, ordinary sync reports a missing-object warning and exits with a failure status. It does not recreate the definition or process other changes. The script's `set -e` also prevents the following `sync setup --new` pass. Once the stale files are removed, the next run can proceed normally.

Do not remove the Git files first. While the definition still exists in xyOps, `sync setup --new` can export it again and commit the files back to Git. This is a manual deletion procedure, not automatic two-way deletion. See the [Sync Guide](sync.md#remove-a-definition-during-two-way-sync) for the general behavior.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `git pull --ff-only` fails | The sync clone and remote branch have diverged, or the working tree changed. Resolve the Git state manually. Do not force-reset the automated checkout without reviewing its commits. |
| `git push` prompts or fails under cron or xySat | Configure noninteractive SSH or HTTPS credentials for the scheduler account and confirm the branch allows that account to push. |
| Git reports an unknown author | Set `user.name` and `user.email` in the dedicated clone for the scheduler account. |
| The wrong side wins a two-way conflict | Check NTP, the xyOps conductor clock, and the modification times of the JSON and neighboring files. A checkout, restore, or file copy can refresh local timestamps. |
| A new Event is not exported | Confirm `sync setup events --new` runs from the repository root and that the API Key can see the Event. Add the correct property path if its script is stored somewhere other than `params.script`. |
| A new Git file is not created in xyOps | Ordinary sync updates definitions that already exist on both sides. Create or import the definition into xyOps first, then let sync manage subsequent changes. |
| A deleted item reappears or causes an error | Follow the [coordinated deletion steps](#delete-a-definition-from-both-sides): delete in xyOps first, then remove and commit its local files. A leftover source stops sync until it is removed. |
| A cron run is skipped | Another cron invocation may hold the `flock` lock. The lock file itself may remain when no lock is held, so check for a running sync process rather than treating the file as stale. |
| A completion command times out | Increase `--cmd_timeout`, investigate Git network latency, and confirm that Git cannot wait for interactive input. |

For the complete behavior and option reference, see the [Filesystem Sync Guide](sync.md) and the [`sync` command reference](help.md#sync).
