import { test, expect } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "pg";
import { startPgHere } from "../index";

const shouldSkip =
  process.env.SKIP_PG_HERE_PROGRAMMATIC_TEST === "1" ||
  (process.platform !== "darwin" && process.platform !== "linux");

const port = Number(process.env.PGPORT_PROGRAMMATIC_TEST ?? (63000 + (process.pid % 1000)));
const installedVersions = (() => {
  try {
    return readdirSync(join(process.cwd(), "pg_local", "bin"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
})();
const pinnedVersion =
  process.env.PG_HERE_TEST_PG_VERSION ?? installedVersions[installedVersions.length - 1];
const expectedVersionPrefix = pinnedVersion
  ? pinnedVersion.split(".").slice(0, 2).join(".")
  : undefined;

test.skipIf(shouldSkip)("programmatic startup creates missing database and preserves data on stop", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "pg-here-programmatic-"));
  const database = "app_startup_db";
  const handle = await startPgHere({
    projectDir,
    port,
    database,
    createDatabaseIfMissing: true,
    installationDir: join(process.cwd(), "pg_local", "bin"),
    postgresVersion: pinnedVersion,
    registerProcessShutdownHandlers: false,
  });

  try {
    const client = new Client({
      connectionString: handle.databaseConnectionString,
    });

    await client.connect();
    const result = await client.query("select current_database() as db");
    expect(result.rows[0]?.db).toBe(database);
    await client.query("create table if not exists persist_test (v text)");
    await client.query("truncate table persist_test");
    await client.query("insert into persist_test (v) values ('kept')");

    if (expectedVersionPrefix) {
      const versionResult = await client.query("show server_version");
      const serverVersion = String(versionResult.rows[0]?.server_version ?? "");
      expect(serverVersion.startsWith(expectedVersionPrefix)).toBe(true);
    }

    await client.end();
    await handle.stop();

    const restartedHandle = await startPgHere({
      projectDir,
      port,
      database,
      createDatabaseIfMissing: true,
      installationDir: join(process.cwd(), "pg_local", "bin"),
      postgresVersion: pinnedVersion,
      registerProcessShutdownHandlers: false,
    });

    try {
      const restartedClient = new Client({
        connectionString: restartedHandle.databaseConnectionString,
      });

      await restartedClient.connect();
      const persisted = await restartedClient.query(
        "select v from persist_test limit 1"
      );
      expect(persisted.rows[0]?.v).toBe("kept");
      await restartedClient.end();
    } finally {
      await restartedHandle.stop();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
