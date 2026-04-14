import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { mkdirSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "path";

/**
 * Shared SQLite database for persistent user configuration:
 * domain groups, log alert rules, and evaluator settings.
 *
 * Opened once and injected into feature services. Kept separate from
 * query-logs.sqlite (ephemeral, high-volume, has its own retention policy).
 */
@Injectable()
export class CompanionDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CompanionDbService.name);
  private _db: DatabaseSync | null = null;

  readonly dbPath =
    (process.env.COMPANION_DB_PATH ?? "").trim() ||
    "/app/config/companion.sqlite";

  get db(): DatabaseSync | null {
    return this._db;
  }

  onModuleInit(): void {
    try {
      mkdirSync(dirname(this.dbPath), { recursive: true });
      this._db = new DatabaseSync(this.dbPath);
      this._db.exec("PRAGMA foreign_keys=ON;");
      this._db.exec("PRAGMA journal_mode=WAL;");
      this._db.exec("PRAGMA synchronous=NORMAL;");
      this.logger.log(`Companion SQLite initialized at ${this.dbPath}`);
    } catch (error) {
      this._db = null;
      this.logger.error(
        `Failed to initialize Companion SQLite at ${this.dbPath}`,
        error as Error,
      );
    }
  }

  onModuleDestroy(): void {
    if (!this._db) {
      return;
    }
    try {
      // SQLite's recommended pre-close cleanup. Cheap (runs ANALYZE only when
      // the planner thinks it'd help) and keeps query plans accurate as table
      // statistics drift over time.
      try {
        this._db.prepare("PRAGMA optimize;").run();
      } catch (error) {
        this.logger.warn(
          `PRAGMA optimize failed before Companion SQLite close: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this._db.close();
    } catch (error) {
      this.logger.warn("Failed to close Companion SQLite DB", error as Error);
    } finally {
      this._db = null;
    }
  }
}
