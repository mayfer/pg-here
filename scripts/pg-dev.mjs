import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startPgHere } from "../index.ts";
import {
  maybePrintLinuxRuntimeHelp,
  getPreStartPgHereState,
  printPgHereStartupInfo,
  startPgHereWithLibxml2Compat,
} from "./cli-error-help.mjs";

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
  .option("auto-port", {
    default: "true",
    describe: "Automatically find available port if requested port is in use",
    type: "string",
  })
  .parse();

let pg;
const preStartState = getPreStartPgHereState(process.cwd());
const startInstance = () =>
  startPgHere({
    projectDir: process.cwd(),
    port: argv.port,
    username: argv.username,
    password: argv.password,
    database: argv.database,
    postgresVersion: argv["pg-version"],
    autoPort: argv["auto-port"] === "true",
  });

try {
  pg = await startPgHereWithLibxml2Compat(startInstance, process.cwd());
} catch (error) {
  if (process.platform === "linux") {
    maybePrintLinuxRuntimeHelp(error);
  }
  throw error;
}

printPgHereStartupInfo({
  connectionString: pg.databaseConnectionString,
  instance: pg.instance,
  preStartState,
  requestedVersion: argv["pg-version"],
});

// keep this process alive; Ctrl-C stops postgres
setInterval(() => {}, 1 << 30);
