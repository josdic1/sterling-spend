import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./index.js";

async function runMigrations() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDirectory = path.resolve(
    __dirname,
    "../../migrations",
  );

  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const alreadyApplied = await db.query(
      `
        SELECT 1
        FROM schema_migrations
        WHERE filename = $1
      `,
      [filename],
    );

    if (alreadyApplied.rowCount !== 0) {
      console.log(`Skipping ${filename}`);
      continue;
    }

    const sql = await readFile(
      path.join(migrationsDirectory, filename),
      "utf8",
    );

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      console.log(`Applying ${filename}`);

      await client.query(sql);

      await client.query(
        `
          INSERT INTO schema_migrations (filename)
          VALUES ($1)
        `,
        [filename],
      );

      await client.query("COMMIT");

      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("Migrations complete");
}

async function main() {
  try {
    await runMigrations();
  } catch (error) {
    console.error("Migration failed");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

void main();
