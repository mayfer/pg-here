import { PostgresInstance } from "pg-embedded";

const root = process.cwd();

const pg = new PostgresInstance({
  // per-project data directory
  dataDir: `${root}/pg_local/data`,

  // where pg-embedded downloads postgres binaries
  installationDir: `${root}/pg_local/bin`,

  // choose a project-specific port
  port: Number(process.env.PGPORT ?? 55432),

  username: "postgres",
  password: "postgres",

  // keep data between runs
  persistent: true,
});

async function shutdown(code = 0) {
  try { await pg.stop(); } catch {}
  try { await pg.cleanup(); } catch {}
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// start postgres (downloads correct arch automatically)
await pg.start();

// print connection string for tooling
console.log(pg.connectionInfo.connectionString);

// keep this process alive; Ctrl-C stops postgres
setInterval(() => {}, 1 << 30);
