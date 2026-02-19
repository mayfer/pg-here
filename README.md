# pg-here

Run a local PostgreSQL instance in your project folder with one command.

## 30-second start

```bash
bunx pg-here
```

Default output:

```text
Launching PostgreSQL 18.0.0 into new pg_local/
psql postgresql://postgres:postgres@localhost:55432/postgres
```

If a data folder already exists:

```text
Reusing existing pg_local/data/ with PostgreSQL 18.0.0
psql postgresql://postgres:postgres@localhost:55432/postgres
```

If the cached folder version differs:

```text
Reusing existing pg_local/data/ (pg_local/bin has 18.0.0, running PostgreSQL is 18.0)
psql postgresql://postgres:postgres@localhost:55432/postgres
```

The process stays alive until you stop it.  
Ctrl+C → exits and stops Postgres.

## Defaults (all args optional)

`bunx pg-here`

- `username = postgres`
- `password = postgres`
- `database = postgres`
- `port = 55432`
- `pg-version` = auto

## Custom run

```bash
bunx pg-here --username me --password secret --database my_app --port 55433 --pg-version 17.0.0
```

You can also run locally in this repo:

```bash
bun run db:up
```

Same CLI flags are supported.

## Programmatic

```ts
import { startPgHere } from "pg-here";

const pg = await startPgHere({
  projectDir: process.cwd(),
  database: "my_app",
  createDatabaseIfMissing: true,
});

console.log(pg.databaseConnectionString); // psql-ready URL
await pg.stop();
```

## Linux runtime error (quick fix)

If startup fails with missing `libxml2` libraries, install runtime packages and retry:

```bash
sudo apt-get update && sudo apt-get install -y libxml2 libxml2-utils
sudo dnf install -y libxml2
sudo apk add libxml2
```

This release already retries startup with a project-local `libxml2` compatibility fallback when needed.

## Version pin / stale cache

If your environment keeps resolving an older release, force a specific version:

```bash
bunx pg-here@0.1.9
```
