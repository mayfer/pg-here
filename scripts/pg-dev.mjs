import { PostgresInstance } from "pg-embedded";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const root = process.cwd();

const argv = await yargs(hideBin(process.argv))
  .option("username", {
    alias: "u",
    default: "postgres",
    describe: "PostgreSQL username",
  })
  .option("password", {
    alias: "p",
    default: "postgres",
    describe: "PostgreSQL password",
  })
  .option("port", {
    default: 55432,
    describe: "PostgreSQL port",
  })
  .parse();

const pg = new PostgresInstance({
  // per-project data directory
  dataDir: `${root}/pg_local/data`,

  // where pg-embedded downloads postgres binaries
  installationDir: `${root}/pg_local/bin`,

  // choose a project-specific port
  port: argv.port,

  username: argv.username,
  password: argv.password,

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
