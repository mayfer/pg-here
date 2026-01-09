import { parseSnapshotTestArgs, runSnapshotTest } from "./apfs-snapshot-test-lib.mjs";

const { projectDir, port, keep, flags } = parseSnapshotTestArgs(process.argv.slice(2));

if (flags.help || flags.h) {
  const defaultProject = undefined;
  console.log("APFS snapshot test (macOS only)");
  console.log("");
  console.log("Usage:");
  console.log("  bun run scripts/apfs-snapshot-test.mjs [projectDir]");
  console.log("");
  console.log("Defaults:");
  console.log("  projectDir: ./pg_projects/apfs_test_TIMESTAMP");
  console.log("  port: 55433 (or PGPORT_SNAPSHOT_TEST)");
  console.log("");
  console.log("Flags:");
  console.log("  --project, -p   project directory (same as positional projectDir)");
  console.log("  --port          postgres port to use");
  console.log("  --keep          keep the project directory after the test");
  console.log("  --help, -h      show this help");
  console.log("");
  console.log("Examples:");
  console.log("  bun run scripts/apfs-snapshot-test.mjs");
  console.log("  bun run scripts/apfs-snapshot-test.mjs --keep");
  console.log("  bun run scripts/apfs-snapshot-test.mjs /tmp/pg_proj --port 55440 --keep");
  process.exit(0);
}

const result = await runSnapshotTest({ projectDir, port, keep });
console.log("✅ APFS clone snapshot test passed");
console.log(`Project data ${keep ? "retained" : "cleaned up"} at ${result.projectDir}`);
