import { spawnSync } from "node:child_process";
import {
  accessSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  F_OK,
} from "node:fs";
import { join } from "node:path";

const LIBXML2_SONAME = "libxml2.so.2";
const LIBXML2_ALTERNATE_SONAME = "libxml2.so.16";
const LIBXML2_COMPAT_DIR = "pg_local/runtime-libs";

const LIB_PATHS = [
  "/usr/lib/x86_64-linux-gnu",
  "/usr/lib/i386-linux-gnu",
  "/usr/lib",
  "/lib/x86_64-linux-gnu",
  "/lib/i386-linux-gnu",
  "/lib",
  "/usr/local/lib",
];

const PG_LOCAL_DIR = "pg_local";
const PG_LOCAL_DATA_DIR = "data";
const PG_LOCAL_BIN_DIR = "bin";
const PG_VERSION_FILE = "PG_VERSION";
const VERSION_DIR_RE = /^\d+\.\d+(?:\.\d+)?$/;

export function maybePrintLinuxRuntimeHelp(error) {
  const message = String(error?.message ?? error);
  const missingLibsFromError = extractMissingLibrariesFromMessage(message);
  const missingLibsFromBinary = extractMissingLibrariesFromBinaryPath(message);
  const binPath = extractBinaryPathFromError(message);

  const missingLibs = [...new Set([...missingLibsFromError, ...missingLibsFromBinary])];

  if (missingLibs.length === 0) {
    return;
  }

  console.error();
  console.error("PostgreSQL startup failed due to missing Linux runtime dependencies.");
  console.error(`Missing libraries: ${missingLibs.join(", ")}`);
  console.error();
  console.error("Install system packages for your distro and retry:");
  console.error(
    "  Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y libxml2 libxml2-dev libxml2-utils"
  );
  console.error(
    "  Fedora/RHEL:   sudo dnf install -y libxml2"
  );
  console.error(
    "  Alpine:        sudo apk add libxml2"
  );
  console.error();
  console.error("  Quick checks:");
  console.error(
    "    find /usr/lib /usr/local/lib /lib -name 'libxml2.so.2*' 2>/dev/null | head"
  );
  if (binPath) {
    console.error(`    ldd ${binPath} | grep libxml2`);
  }
  console.error("    sudo ldconfig && sudo ldconfig -p | grep libxml2.so.2");
  if (binPath.includes("/bin/bin/postgres")) {
    console.error("  Your local pg_local cache looks partially provisioned (bin/bin/postgres path).");
    console.error("  Try removing it and retrying:");
    console.error("    rm -rf pg_local && bunx pg-here@0.1.9");
  }
  console.error(
    `If your distro requires different package names, install packages that provide: ${missingLibs.join(", ")}`
  );
  printPotentialSymlinkHint();

  if (hasLibxml2CompatibilityNeed(error)) {
    const fallback = findLibraryPath(LIBXML2_ALTERNATE_SONAME);
    console.error();
    console.error("Compatibility note:");
    if (fallback) {
      console.error(
        `This host only provides ${LIBXML2_ALTERNATE_SONAME} at ${fallback}, not ${LIBXML2_SONAME}.`
      );
      console.error(
        "This release now retries startup with a project-local symlink fallback automatically."
      );
      console.error(
        `If that does not work, you can retry with a global symlink (requires sudo):\n    sudo ln -sfn ${fallback} /usr/local/lib/${LIBXML2_SONAME} && sudo ldconfig`
      );
    } else {
      console.error(
        `Expected ${LIBXML2_SONAME} was not found and no ${LIBXML2_ALTERNATE_SONAME} fallback was discovered.`
      );
      console.error(
        `Your host may be too minimal or custom; install a PostgreSQL-ready runtime stack for your distro.`
      );
    }
  }
}

export function hasLibxml2CompatibilityNeed(error) {
  const message = String(error?.message ?? error);
  const missingFromMessage = extractMissingLibrariesFromMessage(message);
  const missingFromBinary = extractMissingLibrariesFromBinaryPath(message);
  const missing = [...missingFromMessage, ...missingFromBinary];
  return missing.includes(LIBXML2_SONAME) || message.includes("libxml2.so.2");
}

export function getPreStartPgHereState(projectDir) {
  const normalizedProjectDir = typeof projectDir === "string" && projectDir ? projectDir : process.cwd();
  const dataDir = join(normalizedProjectDir, PG_LOCAL_DIR, PG_LOCAL_DATA_DIR);
  const binDir = join(normalizedProjectDir, PG_LOCAL_DIR, PG_LOCAL_BIN_DIR);
  const hasData = existsSync(dataDir);
  const hasPgVersionFile = existsSync(join(dataDir, PG_VERSION_FILE));
  const installedVersions = getInstalledPostgresVersions(binDir);

  return {
    dataDir,
    hasData,
    hasPgVersionFile,
    installedVersions,
    installedVersion: installedVersions[0] ?? "",
  };
}

export function printPgHereStartupInfo({
  connectionString,
  instance,
  preStartState,
  requestedVersion,
}) {
  const { hasData, installedVersion } = preStartState ?? {};
  const startedVersion = getPostgresInstanceVersion(instance);

  const displayVersion =
    startedVersion || requestedVersion || "default";
  const dataPath = `${PG_LOCAL_DIR}/${PG_LOCAL_DATA_DIR}/`;
  const firstLine = hasData
    ? getExistingDataStatusLine({ installedVersion, startedVersion, requestedVersion, dataPath })
    : `Launching PostgreSQL ${displayVersion} into new ${PG_LOCAL_DIR}/`;

  console.log(firstLine);
  if (typeof connectionString === "string" && connectionString.length > 0) {
    console.log(`psql ${connectionString}`);
  }
}

function getExistingDataStatusLine({
  installedVersion,
  startedVersion,
  requestedVersion,
  dataPath,
}) {
  const runVersion = startedVersion || requestedVersion || "default";
  if (installedVersion && startedVersion && installedVersion !== startedVersion) {
    return `Reusing existing ${dataPath} (pg_local/bin has ${installedVersion}, running PostgreSQL is ${startedVersion})`;
  }

  if (installedVersion && startedVersion && installedVersion === startedVersion) {
    return `Reusing existing ${dataPath} with PostgreSQL ${runVersion}`;
  }

  return `Reusing existing ${dataPath} with PostgreSQL ${runVersion}`;
}

function getPostgresInstanceVersion(instance) {
  try {
    if (typeof instance?.getPostgreSqlVersion === "function") {
      return instance.getPostgreSqlVersion();
    }
  } catch {
    return "";
  }

  return "";
}

function compareSemVerDesc(left, right) {
  const leftParts = left.split(".").map((segment) => Number.parseInt(segment, 10) || 0);
  const rightParts = right.split(".").map((segment) => Number.parseInt(segment, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < maxLength; i += 1) {
    const leftValue = leftParts[i] ?? 0;
    const rightValue = rightParts[i] ?? 0;
    if (leftValue === rightValue) {
      continue;
    }
    return rightValue - leftValue;
  }

  return 0;
}

export async function startPgHereWithLibxml2Compat(start, workingDir) {
  try {
    return await start();
  } catch (error) {
    if (!hasLibxml2CompatibilityNeed(error)) {
      throw error;
    }

    const patched = ensureLibxml2Compatibility(workingDir);
    if (!patched) {
      throw error;
    }

    return await start();
  }
}

function getInstalledPostgresVersions(baseDir) {
  if (!existsSync(baseDir)) {
    return [];
  }

  let entries = [];
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && VERSION_DIR_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareSemVerDesc);
}


export function ensureLibxml2Compatibility(workingDir) {
  if (process.platform !== "linux") {
    return false;
  }

  const projectDir = typeof workingDir === "string" && workingDir ? workingDir : process.cwd();
  const compatDir = join(projectDir, LIBXML2_COMPAT_DIR);
  const compatLib = join(compatDir, LIBXML2_SONAME);

  if (findLibraryPath(LIBXML2_SONAME)) {
    return false;
  }

  const fallback = findLibraryPath(LIBXML2_ALTERNATE_SONAME);
  if (!fallback) {
    return false;
  }

  try {
    mkdirSync(compatDir, { recursive: true });
    if (existsSync(compatLib)) {
      const existing = readCompatLink(compatLib);
      if (existing === fallback) {
        ensureLdLibraryPath(compatDir);
        return true;
      }

      rmSync(compatLib, { force: true });
    }

    symlinkSync(fallback, compatLib);
    ensureLdLibraryPath(compatDir);
    return true;
  } catch {
    return false;
  }
}

function readCompatLink(path) {
  try {
    const info = lstatSync(path);
    if (!info.isSymbolicLink()) {
      return "";
    }
    return readlinkSync(path);
  } catch {
    return "";
  }
}

function ensureLdLibraryPath(path) {
  const currentPath = process.env.LD_LIBRARY_PATH ?? "";
  const paths = currentPath.split(":").filter(Boolean);
  if (paths.includes(path)) {
    return;
  }

  process.env.LD_LIBRARY_PATH = path + (currentPath ? `:${currentPath}` : "");
}

function extractMissingLibrariesFromMessage(message) {
  const regex = /([A-Za-z0-9._-]+\.so(?:\.\d+)*)\b/g;
  const matches = [...message.matchAll(regex)].map((match) => match[1]);
  return matches.filter((value) => value.toLowerCase().includes("so"));
}

function extractMissingLibrariesFromBinaryPath(message) {
  const pathMatch = message.match(/(\/[^\s"]*\/bin\/postgres)/);
  if (!pathMatch) {
    return [];
  }

  const binaryPath = pathMatch[1];
  const result = spawnSync("ldd", [binaryPath], { encoding: "utf8" });
  const output = `${result.stdout ?? ""} ${result.stderr ?? ""}`;
  if (!output) {
    return [];
  }

  return [...output.matchAll(/([^\s]+)\s+=>\s+not found/g)].map(
    (match) => match[1]
  );
}

function extractBinaryPathFromError(message) {
  const pathMatch = message.match(/(\/[^\s"]*\/bin\/postgres)/);
  return pathMatch ? pathMatch[1] : "";
}

function hasLibxmlVersion16Only() {
  const candidates = ["/usr/lib/x86_64-linux-gnu", "/usr/lib", "/lib/x86_64-linux-gnu", "/lib"];
  for (const dir of candidates) {
    try {
      accessSync(`${dir}/libxml2.so.2`, F_OK);
      return false;
    } catch {
      // continue
    }

    try {
      accessSync(`${dir}/libxml2.so.16`, F_OK);
      if (hasLibxmlVersion16AtPath(`${dir}/libxml2.so.16`)) {
        return true;
      }
    } catch {}
  }

  return false;
}

function hasLibxmlVersion16AtPath(path) {
  return typeof path === "string" && path.endsWith("/libxml2.so.16");
}

function printPotentialSymlinkHint() {
  const result = spawnSync("sh", [
    "-c",
    "find /usr/lib /usr/local/lib /lib -name 'libxml2.so.2*' 2>/dev/null",
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    return;
  }

  const matches = (result.stdout ?? "").split("\n").filter(Boolean);
  const exact = matches.find((item) => item.endsWith("/libxml2.so.2"));
  if (!exact) {
    console.error();
    console.error("Hint:");
    if (hasLibxmlVersion16Only()) {
      console.error("This host appears to provide only libxml2.so.16. Compatibility is not guaranteed.");
    } else {
      console.error("No libxml2.so.2 file was found in the standard library paths.");
    }
  }
}

function findLibraryPath(name) {
  const args = [...LIB_PATHS, "-name", `${name}*`, "-print"];
  const result = spawnSync("find", args, { encoding: "utf8" });
  const matches = (result.stdout ?? "").split("\n").filter(Boolean);
  if (matches.length === 0) {
    return "";
  }

  const exact = matches.find((item) => item.endsWith(`/${name}`));
  return exact ?? matches[0];
}
