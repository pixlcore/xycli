# xyCLI Changelog

## Version v1.2.1

> October 29, 2026

- [`c5b6e1c`](https://github.com/pixlcore/xycli/commit/c5b6e1c43296ba8d58d68ebee245b7d27dc4fbfb): Version 1.2.1
- [`a2fca91`](https://github.com/pixlcore/xycli/commit/a2fca9138e5748d70b1e139b6d0b84f082ec7406): Feature: Follow live job retries automatically
- [`6b3686d`](https://github.com/pixlcore/xycli/commit/6b3686d18c72139e32d18e1c90e10f8910565224): Feature: Set custom process title for MCP server.
- [`099444b`](https://github.com/pixlcore/xycli/commit/099444bd87765c1a1e97a65bae6a2b2ea7f4f757): Add LICENSE.md file
- [`2d6c1c4`](https://github.com/pixlcore/xycli/commit/2d6c1c44a73e265fba38b4feb1c2a7aaea843487): Meta: Fix offline test trigger to only run on tag pushes

## Version v1.2.0

> October 25, 2026

- [`3f99851`](https://github.com/pixlcore/xycli/commit/3f9985186f3cba6e04c2fb0cc7b6eae3a7fc7fcb): Fix Windows MCP shutdown tests and update Node.js CI matrix
- [`2034c48`](https://github.com/pixlcore/xycli/commit/2034c48626f999ffb969d4cebb7343cb233d565d): Version 1.2.0
- [`e9693fb`](https://github.com/pixlcore/xycli/commit/e9693fbc527135b45ac2fc39659adb96923d9272): Feature: Expand MCP tools with tickets, alerts, snapshots and servers
- [`1c12b76`](https://github.com/pixlcore/xycli/commit/1c12b76b747d97ccf358501d438e6deb8b97ca4e): Feature: Add Docker image and automated GHCR publishing for xyCLI
- [`fa33af6`](https://github.com/pixlcore/xycli/commit/fa33af6b793786da33d6ae0bf832bcdea182e6b0): Feature: Add MCP server with shared STDIO and HTTP transports

## Version v1.1.1

> October 2, 2026

- [`5f924c6`](https://github.com/pixlcore/xycli/commit/5f924c69ad8c5ed3c04be40d600b95fa3eee5f66): Version 1.1.1
- [`759f8db`](https://github.com/pixlcore/xycli/commit/759f8db93f1763b7e876d16066b7dd04a9681ec3): Doc: Update xyOps version to v1.1.4 in two-way delete tutorial, and add in sys activity exclusions.
- [`551be24`](https://github.com/pixlcore/xycli/commit/551be2413b4e584daebb2ed57710a620a7006372): Dep: Override "basic-ftp" (sub-sub-sub-sub-dep of pixl-request) to v6.2.1 for vuln fix, that isn't fixed in any of the parents.

## Version v1.1.0

> September 30, 2026

- [`50ff6e6`](https://github.com/pixlcore/xycli/commit/50ff6e6f5f11a29287bcf0ffe2d8f7d966d34ee3): Version 1.1.0
- [`5bf07a8`](https://github.com/pixlcore/xycli/commit/5bf07a87cfdc649abd8058c10f73c44b037c8cf4): Fix ticket unit test (due to API key bug fix over in xyOps)
- [`5493608`](https://github.com/pixlcore/xycli/commit/5493608d71dbf8cfd9fbb3f2fef958d1bb107ee1): Feature: Down-sync delete mode, and a new two-way delete setup tut.

## Version v1.0.9

> September 28, 2026

- [`9cbc6c7`](https://github.com/pixlcore/xycli/commit/9cbc6c753e9351243e13a942a3ad19c2012884cb): Version 1.0.9
- [`6a0d739`](https://github.com/pixlcore/xycli/commit/6a0d739c3d85f61758bc9ea25c77a3b00968c79d): Feature: New system hook (syshook) deletion system, for active deletes from xyOps.
- [`eeae786`](https://github.com/pixlcore/xycli/commit/eeae7863361c1f343dedae301a00d99db3fccdbb): Feature: New "--ignore_missing" parameter to suppress missing item warnings.  Fixes #9
- [`80e77d4`](https://github.com/pixlcore/xycli/commit/80e77d40edfdb1c7fb4285235c6cc9fb2f0bcb2a): Bug Fix: Always print all errors and warnings, even in quiet mode.  Fixes #8

## Version v1.0.8

> September 25, 2026

- [`3cc0914`](https://github.com/pixlcore/xycli/commit/3cc0914dd00211e6215ef3f2e5f7b2467570c9d0): Version 1.0.8
- [`04d0f31`](https://github.com/pixlcore/xycli/commit/04d0f31eaee9b89bb5f2518c9bf813d24b5235eb): Meta: Fix offline unit tests on Windows (was using colon in filename)
- [`5570628`](https://github.com/pixlcore/xycli/commit/557062875ab99a4cca41ae419204bc4992962ef1): Bug Fix: Remove some redundant dry run toasts.
- [`536685e`](https://github.com/pixlcore/xycli/commit/536685eae72bc9bea1be24f4ba7e4998f17386fb): Feature: Allow buckets, bucket data and bucket files to all be synced.  Fixes #6
- [`3cc2ccb`](https://github.com/pixlcore/xycli/commit/3cc2ccb93202bce52de6fe09dead7854ca274640): Docs: Added instructions for deleting items with two-way sync
- [`38d336b`](https://github.com/pixlcore/xycli/commit/38d336b20797e435664924623e94d877a74c3c0a): Bug Fix: Allow unknown object properties to sync without error (i.e. for legacy Cronicle imports).
- [`dc1e994`](https://github.com/pixlcore/xycli/commit/dc1e994c3b55eb4040210c8882cf01cd47b0defb): Bug FIx: For printing Emoji, do not use cursor save/restore width-fix when stdout is not a TTY.

## Version v1.0.7

> September 23, 2026

- [`0cce2eb`](https://github.com/pixlcore/xycli/commit/0cce2eb70bc3f17e54fb19c8db43ce937701b68c): Version 1.0.7
- [`4089e78`](https://github.com/pixlcore/xycli/commit/4089e78e9dc67894afa9d5c325af0e7c37e762a6): Bug Fix: Typo in custom job user HTML content when trying to rendering the caption.  Fixes #7.
- [`76a247c`](https://github.com/pixlcore/xycli/commit/76a247c9abadeb9ee6f9c7bfb89d06cd375c41dd): Feature: Sync: Support workflow node sub-property neighbor files.  Fixes #5.

## Version v1.0.6

> September 22, 2026

- [`985c132`](https://github.com/pixlcore/xycli/commit/985c132607e1dcdabbadc829d6f21e599a2eb52b): Version 1.0.6
- [`f0aac32`](https://github.com/pixlcore/xycli/commit/f0aac320cbd301a5dc45862edaec9f842c2c6c79): Feature: Add "xy upgrade" command.
- [`a9b653b`](https://github.com/pixlcore/xycli/commit/a9b653b9649afd15d93cb3d29ee4f23da47bde0a): Bug Fix: Sync files with similar stems and neighbors can get mixed up.  Fixes #4.

## Version v1.0.5

> September 21, 2026

- [`2542921`](https://github.com/pixlcore/xycli/commit/25429212b664130bf767db85f52610c8d07c00aa): Version 1.0.5
- [`8818ec6`](https://github.com/pixlcore/xycli/commit/8818ec6291c0d06ec6b48174443eaf330682cff2): Bug FIx: Help system was breaking on Windows due to CRLF line endings.

## Version v1.0.4

> September 21, 2026

- [`553d4d9`](https://github.com/pixlcore/xycli/commit/553d4d95eec0dd4e966dba03d1cccadee49454fc): Version 1.0.4
- [`4a68d5a`](https://github.com/pixlcore/xycli/commit/4a68d5ad6ab1d2c28b5a5a933e6c6ec711fd2d90): Bug Fix: Validate local command routing before requiring a configured server.

## Version v1.0.3

> September 21, 2026

- [`00c2805`](https://github.com/pixlcore/xycli/commit/00c280596899cee1de66a4179684d1a7992ee1d9): Version 1.0.3
- [`82777d0`](https://github.com/pixlcore/xycli/commit/82777d01cb751769e14987a7cd86e0d71f91ee79): Feature: Add Windows support.  Fixes #3.

## Version v1.0.2

> September 20, 2026

- [`7b9023b`](https://github.com/pixlcore/xycli/commit/7b9023b390ea45b0615ff43b4d5a8d3daa3a68f3): Version 1.0.2
- [`2114287`](https://github.com/pixlcore/xycli/commit/2114287dc98ca2cedcc6cf1b15eb7e164f697851): Feature: Sync Setup: Write out events and workflows into category sub-folders.  Fixes #2.
- [`3f3e8a5`](https://github.com/pixlcore/xycli/commit/3f3e8a515be030e551c33a701c43e2bb3ff72569): Doc: Add two-way git tutorial
- [`4336dc2`](https://github.com/pixlcore/xycli/commit/4336dc25924616038213b77c5892990c09fa22f5): Feature: Sync setup now supports its own "--down_cmd" for running a custom command if and only if files were written out.
- [`7b94e63`](https://github.com/pixlcore/xycli/commit/7b94e632e2c0d86eaef5211325b259195cb30f3c): Feature: Add optional "--new" flag to sync setup, to add newly added items not already in sync set
- [`90d065f`](https://github.com/pixlcore/xycli/commit/90d065f941578ed83783cc79bebbbdc7018a6664): Allow "--default_ext" switch to override default ".txt" file extension for neighbor property files when language cannot be detected.  Ref #1.

## Version v1.0.1

> September 20, 2026

- [`ee12585`](https://github.com/pixlcore/xycli/commit/ee12585b36e7237d8514b9c34ce0411debf16494): Version 1.0.1
- [`c18090a`](https://github.com/pixlcore/xycli/commit/c18090a03ebdb91772fc565b59eec22e4378df3f): Fix: Do not start delete pass if any warnings or errors occurred during the sync.
- [`ef4e68b`](https://github.com/pixlcore/xycli/commit/ef4e68b229b8e0114c0af4a44dc1b61ba81e9e39): Test: Add more event unit tests

## Version v1.0.0

> September 20, 2026

- Initial release!
