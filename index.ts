import { join, resolve } from "node:path";
import { PostgresInstance } from "pg-embedded";

export type PgHereShutdownSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

export interface PgHereOptions {
  projectDir?: string;
  dataDir?: string;
  installationDir?: string;
  postgresVersion?: string;
  version?: string;
  port?: number;
  username?: string;
  password?: string;
  persistent?: boolean;
  database?: string;
  createDatabaseIfMissing?: boolean;
  registerProcessShutdownHandlers?: boolean;
  shutdownSignals?: PgHereShutdownSignal[];
  cleanupOnShutdown?: boolean;
}

export interface StopPgHereOptions {
  cleanup?: boolean;
}

export interface PgHereHandle {
  instance: PostgresInstance;
  connectionString: string;
  databaseConnectionString: string;
  database: string;
  stop: (options?: StopPgHereOptions) => Promise<void>;
  cleanup: () => Promise<void>;
  ensureDatabase: (databaseName?: string) => Promise<boolean>;
  removeShutdownHooks: () => void;
}

const DEFAULT_USERNAME = "postgres";
const DEFAULT_PASSWORD = "postgres";
const DEFAULT_PORT = 55432;
const DEFAULT_DATABASE = "postgres";
const DEFAULT_SHUTDOWN_SIGNALS: PgHereShutdownSignal[] = ["SIGINT", "SIGTERM"];

export function createPgHereInstance(options: PgHereOptions = {}): PostgresInstance {
  const root = resolve(options.projectDir ?? process.cwd());
  const dataDir = resolve(options.dataDir ?? join(root, "pg_local", "data"));
  const installationDir = resolve(
    options.installationDir ?? join(root, "pg_local", "bin")
  );
  const postgresVersion = options.postgresVersion ?? options.version;

  return new PostgresInstance({
    version: postgresVersion,
    dataDir,
    installationDir,
    port: options.port ?? DEFAULT_PORT,
    username: options.username ?? DEFAULT_USERNAME,
    password: options.password ?? DEFAULT_PASSWORD,
    persistent: options.persistent ?? true,
  });
}

export async function ensurePgHereDatabase(
  instance: PostgresInstance,
  databaseName: string
): Promise<boolean> {
  if (!databaseName || databaseName === DEFAULT_DATABASE) {
    return false;
  }

  const exists = await instance.databaseExists(databaseName);
  if (exists) {
    return false;
  }

  await instance.createDatabase(databaseName);
  return true;
}

export async function stopPgHere(
  instance: PostgresInstance,
  options: StopPgHereOptions = {}
): Promise<void> {
  try {
    await instance.stop();
  } catch {
    // no-op
  }

  if (options.cleanup) {
    try {
      await instance.cleanup();
    } catch {
      // no-op
    }
  }
}

export async function startPgHere(options: PgHereOptions = {}): Promise<PgHereHandle> {
  const instance = createPgHereInstance(options);
  await instance.start();

  const database = options.database ?? DEFAULT_DATABASE;
  const shouldCreate =
    options.createDatabaseIfMissing ?? database !== DEFAULT_DATABASE;

  if (shouldCreate) {
    await ensurePgHereDatabase(instance, database);
  }

  const defaultCleanupOnShutdown = options.cleanupOnShutdown ?? false;
  const connectionString = instance.connectionInfo.connectionString;
  const databaseConnectionString = setConnectionDatabase(connectionString, database);
  let removeShutdownHooks = () => {};

  const stopHandle = async (stopOptions: StopPgHereOptions = {}) => {
    removeShutdownHooks();
    const cleanup = stopOptions.cleanup ?? defaultCleanupOnShutdown;
    await stopPgHere(instance, { cleanup });
  };

  if (options.registerProcessShutdownHandlers ?? true) {
    removeShutdownHooks = registerPgHereShutdownHandlers({
      stop: async () => stopHandle({ cleanup: defaultCleanupOnShutdown }),
      signals: options.shutdownSignals ?? DEFAULT_SHUTDOWN_SIGNALS,
    });
  }

  return {
    instance,
    connectionString,
    databaseConnectionString,
    database,
    stop: stopHandle,
    cleanup: async () => stopHandle({ cleanup: true }),
    ensureDatabase: async (databaseName = database) =>
      ensurePgHereDatabase(instance, databaseName),
    removeShutdownHooks,
  };
}

function setConnectionDatabase(connectionString: string, database: string): string {
  const connectionUrl = new URL(connectionString);
  connectionUrl.pathname = `/${database}`;
  return connectionUrl.toString();
}

function registerPgHereShutdownHandlers({
  stop,
  signals,
}: {
  stop: () => Promise<void>;
  signals: PgHereShutdownSignal[];
}): () => void {
  let isStopping = false;
  const uniqueSignals = [...new Set(signals)];

  const handlers = uniqueSignals.map((signal) => {
    const handler = () => {
      if (isStopping) {
        return;
      }
      isStopping = true;

      void (async () => {
        try {
          await stop();
        } finally {
          process.exit(0);
        }
      })();
    };

    process.on(signal, handler);
    return { signal, handler };
  });

  return () => {
    for (const { signal, handler } of handlers) {
      process.off(signal, handler);
    }
  };
}
