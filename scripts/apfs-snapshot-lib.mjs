import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const pad2 = (value) => String(value).padStart(2, "0");

export function timestamp() {
  const now = new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureProjectLayout(projectDir) {
  await fs.mkdir(path.join(projectDir, "instances"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "snaps"), { recursive: true });
}

export async function setCurrentSymlink(currentPath, targetPath) {
  try {
    const stat = await fs.lstat(currentPath);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-symlink current at ${currentPath}`);
    }
    await fs.unlink(currentPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  await fs.symlink(targetPath, currentPath);
}

async function resolveCloneSource(src) {
  const stat = await fs.lstat(src);
  if (stat.isSymbolicLink()) {
    return await fs.realpath(src);
  }
  return src;
}

export async function cloneDir(src, dest) {
  const source = await resolveCloneSource(src);
  const cpResult = spawnSync("cp", ["-cR", source, dest], { stdio: "inherit" });
  if (cpResult.status === 0) return;
  const dittoResult = spawnSync("ditto", ["--clone", source, dest], { stdio: "inherit" });
  if (dittoResult.status !== 0) {
    throw new Error(`Clone failed (cp exit ${cpResult.status}, ditto exit ${dittoResult.status})`);
  }
}

function compareVersions(a, b) {
  const partsA = a.split(".").map((part) => Number(part));
  const partsB = b.split(".").map((part) => Number(part));
  const max = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < max; i += 1) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va !== vb) return vb - va;
  }
  return 0;
}

export async function resolvePgCtl({ rootDir } = {}) {
  if (process.env.PG_CTL) return process.env.PG_CTL;

  const baseDir = path.join(rootDir ?? process.cwd(), "pg_local", "bin");
  if (await pathExists(baseDir)) {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const versions = entries
      .filter((entry) => entry.isDirectory() && /^\d+\.\d+(\.\d+)?$/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareVersions);

    for (const version of versions) {
      const candidate = path.join(baseDir, version, "bin", "pg_ctl");
      if (await pathExists(candidate)) return candidate;
    }
  }

  return "pg_ctl";
}

export function runPgCtl(pgCtl, args) {
  const result = spawnSync(pgCtl, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pg_ctl failed: ${pgCtl} ${args.join(" ")}`);
  }
}

export function parseArgs(argv) {
  const args = [...argv];
  const positionals = [];
  const flags = {};

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
      continue;
    }
    if (value.startsWith("-")) {
      const key = value.slice(1);
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
      continue;
    }
    positionals.push(value);
  }

  return { positionals, flags };
}

export function resolveProjectDir({ projectArg, flags, defaultName = "default" } = {}) {
  const projectFlag = flags.project ?? flags.p ?? process.env.PG_PROJECT;
  const base = projectArg ?? projectFlag;
  if (base) return path.resolve(base);

  const root = process.cwd();
  return path.join(root, "pg_projects", defaultName);
}
