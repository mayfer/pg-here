import path from "node:path";
import fs from "node:fs/promises";
import { PostgresInstance } from "pg-embedded";
import pg from "pg";
import {
  cloneDir,
  ensureProjectLayout,
  parseArgs,
  resolveProjectDir,
  setCurrentSymlink,
  timestamp,
} from "./apfs-snapshot-lib.mjs";

const { Client } = pg;

function formatMs(ms) {
  return `${ms.toFixed(1)}ms`;
}

async function withClient(pgInstance, fn) {
  const client = new Client(pgInstance.connectionInfo.connectionString);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function initCluster({ root, activeInstance, port, postgresVersion }) {
  const pgInit = new PostgresInstance({
    version: postgresVersion,
    dataDir: activeInstance,
    installationDir: path.join(root, "pg_local", "bin"),
    port,
    username: "postgres",
    password: "postgres",
    persistent: true,
  });
  await pgInit.start();
  await pgInit.stop();
}

const { positionals, flags } = parseArgs(process.argv.slice(2));
const [projectArg] = positionals;

if (flags.help || flags.h) {
  const defaultProject = resolveProjectDir({ projectArg: undefined, flags: {}, defaultName: "bench" });
  console.log("APFS clone benchmark (macOS only)");
  console.log("");
  console.log("Usage:");
  console.log("  bun run scripts/apfs-clone-bench.mjs [projectDir]");
  console.log("");
  console.log("Defaults:");
  console.log(`  projectDir: ${defaultProject}`);
  console.log("  port: 55434 (or PGPORT_BENCH)");
  console.log("  small rows: 50_000");
  console.log("  large rows: 2_000_000");
  console.log("  row bytes: 256");
  console.log("  pg-version: from PG_VERSION or pg-embedded default");
  console.log("");
  console.log("Flags:");
  console.log("  --project, -p     project directory (same as positional projectDir)");
  console.log("  --port            postgres port to use");
  console.log("  --small-rows      rows for small dataset");
  console.log("  --large-rows      rows for large dataset");
  console.log("  --row-bytes       payload size per row");
  console.log("  --pg-version      postgres version (e.g. 18.0.0 or >=17.0)");
  console.log("  --help, -h        show this help");
  process.exit(0);
}

const projectDir = resolveProjectDir({ projectArg, flags, defaultName: "bench" });
const instancesDir = path.join(projectDir, "instances");
const snapsDir = path.join(projectDir, "snaps");
const currentPath = path.join(projectDir, "current");
const activeInstance = path.join(instancesDir, "inst_active");

const port = flags.port ? Number(flags.port) : Number(process.env.PGPORT_BENCH ?? 55434);
const postgresVersion = flags["pg-version"] ?? process.env.PG_VERSION;
const smallRows = flags["small-rows"] ? Number(flags["small-rows"]) : 50_000;
const largeRows = flags["large-rows"] ? Number(flags["large-rows"]) : 2_000_000;
const rowBytes = flags["row-bytes"] ? Number(flags["row-bytes"]) : 256;

await ensureProjectLayout(projectDir);

const activeExists = await fs
  .access(activeInstance)
  .then(() => true)
  .catch(() => false);
if (!activeExists) {
  console.log("Initialize new Postgres cluster");
  await initCluster({ root: process.cwd(), activeInstance, port, postgresVersion });
}
await setCurrentSymlink(currentPath, activeInstance);

const pgInstance = new PostgresInstance({
  version: postgresVersion,
  dataDir: currentPath,
  installationDir: path.join(process.cwd(), "pg_local", "bin"),
  port,
  username: "postgres",
  password: "postgres",
  persistent: true,
});

async function seedAndClone({ label, rows }) {
  console.log("");
  console.log(`Dataset: ${label} (${rows.toLocaleString()} rows, ${rowBytes} bytes/row)`);

  console.log("Start Postgres");
  await pgInstance.start();

  console.log("Seed table");
  const seedStart = performance.now();
  await withClient(pgInstance, async (client) => {
    await client.query("DROP TABLE IF EXISTS bench_data");
    await client.query("CREATE TABLE bench_data (id bigserial PRIMARY KEY, payload text)");
    await client.query(
      `INSERT INTO bench_data (payload) SELECT repeat('x', $1) FROM generate_series(1, $2)`
      , [rowBytes, rows]
    );
  });
  const seedMs = performance.now() - seedStart;
  console.log(`Seed time: ${formatMs(seedMs)}`);

  console.log("Stop Postgres before clone");
  await pgInstance.stop();

  const snapName = `bench_${label}_${timestamp()}`;
  const snapPath = path.join(snapsDir, snapName);
  console.log(`Clone snapshot: ${snapName}`);
  const cloneStart = performance.now();
  await cloneDir(currentPath, snapPath);
  const cloneMs = performance.now() - cloneStart;
  console.log(`Clone time: ${formatMs(cloneMs)}`);

  return { snapName, seedMs, cloneMs };
}

try {
  await seedAndClone({ label: "small", rows: smallRows });
  await seedAndClone({ label: "large", rows: largeRows });
} finally {
  try {
    await pgInstance.stop();
  } catch {}
}

console.log("");
console.log(`Done. Snapshots are in ${snapsDir}`);
