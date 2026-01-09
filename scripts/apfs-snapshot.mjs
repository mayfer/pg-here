import fs from "node:fs/promises";
import path from "node:path";
import {
  cloneDir,
  ensureProjectLayout,
  parseArgs,
  resolvePgCtl,
  resolveProjectDir,
  runPgCtl,
  setCurrentSymlink,
  timestamp,
} from "./apfs-snapshot-lib.mjs";

const { positionals, flags } = parseArgs(process.argv.slice(2));
const [command, projectArg, snapNamePos] = positionals;
const snapName = flags.snap ?? flags.s ?? snapNamePos;

if (flags.help || flags.h || !command) {
  const defaultProject = resolveProjectDir({ projectArg: undefined, flags: {} });
  console.log("APFS snapshot helper (macOS only)");
  console.log("");
  console.log("Usage:");
  console.log("  bun run scripts/apfs-snapshot.mjs snapshot [projectDir]");
  console.log("  bun run scripts/apfs-snapshot.mjs revert [projectDir] <snapName>");
  console.log("  bun run scripts/apfs-snapshot.mjs list [projectDir]");
  console.log("");
  console.log("Defaults:");
  console.log(`  projectDir: ${defaultProject}`);
  console.log("  pg_ctl: from PG_CTL or ./pg_local/bin/*/bin/pg_ctl or PATH");
  console.log("");
  console.log("Flags:");
  console.log("  --project, -p   project directory (same as positional projectDir)");
  console.log("  --snap, -s      snapshot name for revert (e.g. snap_20260109_143012)");
  console.log("  --pg-ctl        full path to pg_ctl (overrides PG_CTL)");
  console.log("  --help, -h      show this help");
  console.log("");
  console.log("Examples:");
  console.log("  bun run scripts/apfs-snapshot.mjs snapshot"); 
  console.log("  bun run scripts/apfs-snapshot.mjs snapshot /tmp/myproj");
  console.log("  bun run scripts/apfs-snapshot.mjs list /tmp/myproj");
  console.log("  bun run scripts/apfs-snapshot.mjs revert /tmp/myproj snap_20260109_143012");
  process.exit(0);
}

if (flags["pg-ctl"]) {
  process.env.PG_CTL = flags["pg-ctl"];
}

const projectDir = resolveProjectDir({ projectArg, flags });
const currentPath = path.join(projectDir, "current");
const instancesDir = path.join(projectDir, "instances");
const snapsDir = path.join(projectDir, "snaps");

await ensureProjectLayout(projectDir);

const pgCtl = await resolvePgCtl({ rootDir: process.cwd() });

async function assertCurrentSymlink() {
  const stat = await fs.lstat(currentPath);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Expected ${currentPath} to be a symlink`);
  }
}

if (command === "snapshot") {
  await assertCurrentSymlink();
  runPgCtl(pgCtl, ["-D", currentPath, "stop", "-m", "fast"]);
  const name = `snap_${timestamp()}`;
  const dest = path.join(snapsDir, name);
  await cloneDir(currentPath, dest);
  runPgCtl(pgCtl, ["-D", currentPath, "start"]);
  console.log(name);
  process.exit(0);
}

if (command === "revert") {
  if (!snapName) {
    console.error("Revert requires a snapName (e.g. snap_YYYYMMDD_HHMMSS)");
    process.exit(1);
  }
  await assertCurrentSymlink();
  const source = path.join(snapsDir, snapName);
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Snapshot not found: ${source}`);
  }
  runPgCtl(pgCtl, ["-D", currentPath, "stop", "-m", "fast"]);
  const instName = `inst_${timestamp()}`;
  const dest = path.join(instancesDir, instName);
  await cloneDir(source, dest);
  await setCurrentSymlink(currentPath, dest);
  runPgCtl(pgCtl, ["-D", currentPath, "start"]);
  console.log(instName);
  process.exit(0);
}

if (command === "list") {
  const entries = await fs.readdir(snapsDir, { withFileTypes: true });
  entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("snap_"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((entry) => console.log(entry.name));
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
