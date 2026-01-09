# embedded_postgres

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## APFS clone snapshots (macOS) — insanely simple

### The 30‑second version

```
# take a snapshot for the default project directory
bun run snapshot snapshot

# list snapshots
bun run snapshot list

# revert to a snapshot (copy from list output)
bun run snapshot revert snap_YYYYMMDD_HHMMSS

# or use the alias
bun run revert snap_YYYYMMDD_HHMMSS
```

By default, snapshots live under `./pg_projects/default`. You can pass a project directory explicitly if you want.

### What this does

- Uses APFS copy‑on‑write clones (`cp -cR` / `ditto --clone`)
- Stops Postgres during snapshot/revert (cold stop/start)
- Keeps snapshots immutable and restores into new instances

### Why it’s great

- Near‑instant snapshot and revert via copy‑on‑write
- Space grows only with changed blocks
- No volume‑wide rollback
- No WAL/PITR complexity
- macOS‑native, zero extra services
- Deterministic failure modes

### Operational constraints

- PostgreSQL must be stopped for snapshot/revert
- Source and destination must be on the same APFS volume
- One cluster per project

### Under the hood layout

```
~/pg/proj/
  current -> instances/inst_active
  instances/
  snaps/
```

### Full commands (helper script)

```
# snapshot current cluster
bun run snapshot snapshot /path/to/project

# list snapshots
bun run snapshot list /path/to/project

# revert to a snapshot
bun run snapshot revert /path/to/project snap_YYYYMMDD_HHMMSS
```

Flags (optional):

```
--project/-p   project directory (same as positional projectDir)
--snap/-s      snapshot name (for revert)
--pg-ctl       path to pg_ctl (overrides PG_CTL)
```

If `pg_ctl` isn’t on your `PATH`, set `PG_CTL`. By default the script looks in `./pg_local/bin/*/bin/pg_ctl`.

### One‑shot test (does everything end‑to‑end)

```
bun run snapshot:test
```

This:
1) Starts a temporary cluster
2) Writes sample data
3) Snapshots
4) Mutates data
5) Restores
6) Verifies the original data returns

Optional flags:

```
--project/-p   project directory (default: ./pg_projects/apfs_test_TIMESTAMP)
--port         postgres port (default: 55433 or PGPORT_SNAPSHOT_TEST)
--keep         keep the project directory after the test
```

### Bun test integration

```
bun test
bun run test:apfs
```

Set `SKIP_APFS_TEST=1` to skip the APFS snapshot test.

### When to choose something else

- Need online “rewind to 5 minutes ago” repeatedly → base backup + WAL/PITR
- Dataset ≥ ~50 GB with heavy churn → dedicated APFS volume + volume snapshots, or move DB off the laptop
