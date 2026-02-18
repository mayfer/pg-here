# pg-here

Per-project Postgres instances with instant snapshot & restore to support yolo development methods.

Repository: https://github.com/mayfer/pg-here

## Project-Local PostgreSQL Setup

Each project runs its own isolated PostgreSQL instance. Downloads correct binary automatically for your CPU architecture (x86_64 / arm64). Database lives inside the project folder.

### Quick Start

Start PostgreSQL:

```bash
bun run db:up
```

Output:
```
postgresql://postgres:postgres@localhost:55432/postgres
```

Connect from your app using that connection string, then Ctrl+C to stop.

### One-command start from npm (no local install)

If you have Bun installed, you can run the published package directly:

```bash
bunx pg-here
```

If this command currently fails with `could not determine executable to run for package`, you’re using a release that was published before the CLI binary was exposed. It will work after the next publish.

This starts a local PostgreSQL instance in your current project directory and prints the connection string, then keeps the process alive until you stop it.

`bunx pg-here` uses these defaults if you pass nothing:
- `username=postgres`
- `password=postgres`
- `database=postgres`
- `port=55432`

All args are optional.

Pass CLI flags just like the local script when you want to override defaults:

```bash
bunx pg-here --username postgres --password postgres --database my_app --port 55432
```

### Programmatic usage

Use `pg-here` directly from your server startup code and auto-create the app database if missing.

```ts
import { startPgHere } from "pg-here";

const pgHere = await startPgHere({
  projectDir: process.cwd(),
  port: 55432,
  database: "my_app",
  createDatabaseIfMissing: true,
  postgresVersion: "18.0.0",
});

console.log(pgHere.databaseConnectionString);

// On shutdown:
await pgHere.stop();
```

`databaseConnectionString` points to your target DB (`my_app` above).  
If the DB does not exist yet, `createDatabaseIfMissing: true` creates it on startup.
Set `postgresVersion` if you want to pin/select a specific PostgreSQL version.
By default, `startPgHere()` installs SIGINT/SIGTERM shutdown hooks that stop Postgres when
your process exits, and `stop()` preserves data (no cluster cleanup/delete).
Use `await pgHere.cleanup()` only when you explicitly want full resource cleanup.
`pg_stat_statements` is enabled automatically (`shared_preload_libraries` + extension creation).
Set `enablePgStatStatements: false` to opt out.

### CLI Options

```bash
# Custom credentials
bun run db:up --username postgres --password postgres

# Short flags
bun run db:up -u postgres -p postgres

# Custom port
bun run db:up --port 55433

# All together
bun run db:up -u postgres -p postgres --database postgres --port 55433

# Pin postgres version
bun run db:up --pg-version 18.0.0
```

**Defaults**: username=`postgres`, password=`postgres`, port=`55432`, pg-version=`PG_VERSION` or pg-embedded default

### Project Structure

```
project/
  pg_local/
    data/        # PostgreSQL data cluster (persists between runs)
    bin/         # Downloaded PostgreSQL binaries
  scripts/
    pg-dev.mjs   # Runner script
  package.json
```

### How It Works

- PostgreSQL only runs when you execute `bun run db:up`
- Correct architecture binary downloads automatically on first run
- Data persists in `pg_local/data/` across restarts
- Process stops completely on exit (Ctrl+C)
- One instance per project, no system PostgreSQL dependency

---

## Use this from another project (recommended)

Keep this repo in one place, and point it at any other project directory when you want a dedicated Postgres instance there.

Example: your app lives at `/path/to/my-app`, but this repo lives elsewhere.

```
# start postgres for that project (one-time init happens automatically)
bun run snapshot snapshot /path/to/my-app/.pg-here

# list snapshots for that project
bun run snapshot list /path/to/my-app/.pg-here

# revert that project to a snapshot
bun run revert /path/to/my-app/.pg-here snap_YYYYMMDD_HHMMSS
```

Tips:
- Pick a per-project folder (e.g. `.pg-here`) and reuse it.
- The project directory just needs to be on the same APFS volume for clones to be fast.
- You can also pass the directory with `--project/-p` instead of positional.

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

### Why it's great

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

If `pg_ctl` isn't on your `PATH`, set `PG_CTL`. By default the script looks in `./pg_local/bin/*/bin/pg_ctl`.

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
--pg-version   postgres version (default: PG_VERSION or pg-embedded default)
--keep         keep the project directory after the test
```

### Bun test integration

```
bun test
bun run test:apfs
```

Set `SKIP_APFS_TEST=1` to skip the APFS snapshot test.

## APFS clone speed benchmark

Compares clone time between a small and large dataset by seeding a table and cloning the data directory.

```
bun run bench:apfs
```

Optional flags:

```
--project/-p   project directory (default: ./pg_projects/bench)
--port         postgres port (default: 55434 or PGPORT_BENCH)
--small-rows   rows for small dataset (default: 50_000)
--large-rows   rows for large dataset (default: 2_000_000)
--row-bytes    payload bytes per row (default: 256)
--pg-version   postgres version (default: PG_VERSION or pg-embedded default)
```

Example:

```
bun run bench:apfs --small-rows 100000 --large-rows 5000000 --row-bytes 512
```

### When to choose something else

- Need online "rewind to 5 minutes ago" repeatedly → base backup + WAL/PITR
- Dataset ≥ ~50 GB with heavy churn → dedicated APFS volume + volume snapshots, or move DB off the laptop
