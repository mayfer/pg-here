import path from "node:path";
import fs from "node:fs/promises";
import { PostgresInstance } from "pg-embedded";
import pg from "pg";
import {
  cloneDir,
  ensureProjectLayout,
  parseArgs,
  setCurrentSymlink,
  timestamp,
} from "./apfs-snapshot-lib.mjs";

const { Client } = pg;

async function withClient(pgInstance, fn) {
  const client = new Client(pgInstance.connectionInfo.connectionString);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function fetchRows(pgInstance) {
  return await withClient(pgInstance, async (client) => {
    const result = await client.query("SELECT id, note FROM snapshot_test ORDER BY id");
    return result.rows;
  });
}

async function initCluster({ root, activeInstance, port }) {
  const pgInit = new PostgresInstance({
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

export async function runSnapshotTest({
  projectDir,
  port,
  keep = false,
} = {}) {
  const root = process.cwd();
  const projectsRoot = path.join(root, "pg_projects");
  const resolvedProjectDir = projectDir ?? path.join(projectsRoot, `apfs_test_${timestamp()}`);
  const instancesDir = path.join(resolvedProjectDir, "instances");
  const snapsDir = path.join(resolvedProjectDir, "snaps");
  const currentPath = path.join(resolvedProjectDir, "current");
  const activeInstance = path.join(instancesDir, "inst_active");

  await ensureProjectLayout(resolvedProjectDir);

  const pgPort = port ?? Number(process.env.PGPORT_SNAPSHOT_TEST ?? 55433);

  const activeExists = await fs
    .access(activeInstance)
    .then(() => true)
    .catch(() => false);
  if (!activeExists) {
    await initCluster({ root, activeInstance, port: pgPort });
  }
  await setCurrentSymlink(currentPath, activeInstance);

  const pgInstance = new PostgresInstance({
    dataDir: currentPath,
    installationDir: path.join(root, "pg_local", "bin"),
    port: pgPort,
    username: "postgres",
    password: "postgres",
    persistent: true,
  });

  try {
    await pgInstance.start();

    await withClient(pgInstance, async (client) => {
      await client.query("DROP TABLE IF EXISTS snapshot_test");
      await client.query("CREATE TABLE snapshot_test (id integer PRIMARY KEY, note text)");
      await client.query("INSERT INTO snapshot_test (id, note) VALUES (1, 'alpha'), (2, 'beta')");
    });

    const expectedRows = await fetchRows(pgInstance);
    await pgInstance.stop();

    const snapName = `snap_${timestamp()}`;
    await cloneDir(currentPath, path.join(snapsDir, snapName));

    await pgInstance.start();
    await withClient(pgInstance, async (client) => {
      await client.query("DELETE FROM snapshot_test WHERE id = 1");
      await client.query("INSERT INTO snapshot_test (id, note) VALUES (3, 'gamma')");
    });
    const mutatedRows = await fetchRows(pgInstance);
    if (JSON.stringify(mutatedRows) === JSON.stringify(expectedRows)) {
      throw new Error("Mutation step did not change data as expected");
    }
    await pgInstance.stop();

    const instanceName = `inst_${timestamp()}`;
    const restoredInstance = path.join(instancesDir, instanceName);
    await cloneDir(path.join(snapsDir, snapName), restoredInstance);
    await setCurrentSymlink(currentPath, restoredInstance);

    await pgInstance.start();
    const restoredRows = await fetchRows(pgInstance);
    await pgInstance.stop();

    if (JSON.stringify(restoredRows) !== JSON.stringify(expectedRows)) {
      throw new Error("Snapshot restore did not return expected rows");
    }

    return { projectDir: resolvedProjectDir, snapName, instanceName };
  } finally {
    try {
      await pgInstance.stop();
    } catch {}
    if (!keep) {
      await fs.rm(resolvedProjectDir, { recursive: true, force: true });
    }
  }
}

export function parseSnapshotTestArgs(argv) {
  const { positionals, flags } = parseArgs(argv);
  const [projectArg] = positionals;
  const projectDir = projectArg ?? flags.project ?? flags.p;
  const port = flags.port ? Number(flags.port) : undefined;
  const keep = Boolean(flags.keep);

  return { projectDir, port, keep, flags };
}
