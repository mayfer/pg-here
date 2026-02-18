import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startPgHere } from "../index.ts";

const argv = await yargs(hideBin(process.argv))
  .version(false)
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
  .option("database", {
    alias: "d",
    default: "postgres",
    describe: "Database to use (created automatically if missing)",
  })
  .option("pg-version", {
    default: process.env.PG_VERSION,
    describe: "PostgreSQL version (e.g. 18.0.0 or >=17.0)",
  })
  .parse();

const pg = await startPgHere({
  projectDir: process.cwd(),
  port: argv.port,
  username: argv.username,
  password: argv.password,
  database: argv.database,
  postgresVersion: argv["pg-version"],
});

// print connection string for tooling
console.log(pg.databaseConnectionString);

// keep this process alive; Ctrl-C stops postgres
setInterval(() => {}, 1 << 30);
