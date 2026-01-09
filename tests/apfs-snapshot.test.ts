import { test, expect } from "bun:test";
import { runSnapshotTest } from "../scripts/apfs-snapshot-test-lib.mjs";

const shouldSkip = process.platform !== "darwin" || process.env.SKIP_APFS_TEST === "1";

const port = Number(
  process.env.PGPORT_SNAPSHOT_TEST ?? (62000 + (process.pid % 1000))
);

test.skipIf(shouldSkip)("APFS clone snapshot roundtrip", async () => {
  const result = await runSnapshotTest({ port });
  expect(result.snapName.startsWith("snap_")).toBe(true);
  expect(result.instanceName.startsWith("inst_")).toBe(true);
});
