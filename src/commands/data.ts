/**
 * Papyrus CLI - Data Management Commands
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { createBackup, exportData, importData } from "../api.js";
import { getDataDir } from "../config.js";
import { formatFileSize, readFileSafe } from "../utils.js";

/**
 * Get database file path
 */
function getDbPath(): string {
  return join(getDataDir(), "Papyrusdata.db");
}

/**
 * Get backup directory path
 */
function getBackupDir(): string {
  const dir = join(getDataDir(), "backups");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Backup command
 */
export async function backupCommand(options: { output?: string }): Promise<void> {
  try {
    // Try API backup first
    const result = await createBackup();
    console.log(`\n✅ Backup created via API: ${result.path}`);
  } catch {
    // Fallback to local backup
    const dbPath = getDbPath();

    if (!existsSync(dbPath)) {
      console.error("Database not found. Make sure Papyrus is set up correctly.");
      process.exit(1);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = options.output ?? `papyrus-backup-${timestamp}.db.bak`;
    const backupPath = resolve(backupName);

    // Ensure backup directory exists
    const backupDir = dirname(backupPath);
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }

    copyFileSync(dbPath, backupPath);

    const size = statSync(backupPath).size;
    console.log(`\n✅ Backup created successfully!`);
    console.log(`   Path: ${backupPath}`);
    console.log(`   Size: ${formatFileSize(size)}`);
  }
}

/**
 * Restore command
 */
export async function restoreCommand(backupPath: string, force = false): Promise<void> {
  const resolvedPath = resolve(backupPath);

  if (!existsSync(resolvedPath)) {
    console.error(`Backup file not found: ${backupPath}`);
    process.exit(1);
  }

  const dbPath = getDbPath();

  if (!force) {
    const { confirm } = await import("../utils.js");
    const confirmed = await confirm("This will overwrite your current database. Are you sure?");
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  // Create safety backup first
  const safetyBackup = `${dbPath}.safety-${Date.now()}.bak`;
  if (existsSync(dbPath)) {
    copyFileSync(dbPath, safetyBackup);
    console.log(`Safety backup created: ${safetyBackup}`);
  }

  copyFileSync(resolvedPath, dbPath);
  console.log(`\n✅ Database restored from ${backupPath}`);
}

/**
 * List backups command
 */
export async function listBackupsCommand(): Promise<void> {
  const backupDir = getBackupDir();

  if (!existsSync(backupDir)) {
    console.log("No backups found.");
    return;
  }

  const files = readdirSync(backupDir)
    .filter((f) => f.endsWith(".bak") || f.endsWith(".db"))
    .map((f) => {
      const path = join(backupDir, f);
      const stats = statSync(path);
      return {
        name: f,
        size: stats.size,
        created: stats.birthtime,
        path,
      };
    })
    .sort((a, b) => b.created.getTime() - a.created.getTime());

  if (files.length === 0) {
    console.log("No backups found.");
    return;
  }

  console.log(`\n📦 Backups (${files.length}):\n`);

  for (const file of files) {
    console.log(`  ${file.name}`);
    console.log(`    Size: ${formatFileSize(file.size)}`);
    console.log(`    Created: ${file.created.toLocaleString()}`);
  }
}

/**
 * Export command
 */
export async function exportCommand(output: string): Promise<void> {
  try {
    const data = await exportData();
    const { writeFileSync } = await import("fs");

    const json = JSON.stringify(data, null, 2);
    writeFileSync(resolve(output), json, "utf-8");

    const size = statSync(resolve(output)).size;
    console.log(`\n✅ Data exported to ${output}`);
    console.log(`   Size: ${formatFileSize(size)}`);
  } catch (error) {
    console.error(`Export failed: ${error}`);
    process.exit(1);
  }
}

/**
 * Import command
 */
export async function importCommand(filePath: string, force = false): Promise<void> {
  const resolvedPath = resolve(filePath);

  if (!existsSync(resolvedPath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const content = readFileSafe(resolvedPath);
  if (!content) {
    console.error(`Cannot read file: ${filePath}`);
    process.exit(1);
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    console.error("Invalid JSON file.");
    process.exit(1);
  }

  if (!force) {
    const { confirm } = await import("../utils.js");
    const confirmed = await confirm("This will import data into your database. Continue?");
    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }
  }

  try {
    await importData(data);
    console.log(`\n✅ Data imported successfully!`);
  } catch (error) {
    console.error(`Import failed: ${error}`);
    process.exit(1);
  }
}

/**
 * Stats command
 */
export async function statsCommand(): Promise<void> {
  const dataDir = getDataDir();
  const dbPath = getDbPath();

  console.log("\n📊 Data Statistics\n");
  console.log(`  Data Directory: ${dataDir}`);

  if (existsSync(dbPath)) {
    const stats = statSync(dbPath);
    console.log(`  Database Size: ${formatFileSize(stats.size)}`);
    console.log(`  Last Modified: ${stats.mtime.toLocaleString()}`);
  } else {
    console.log("  Database: Not found");
  }

  // Count backups
  const backupDir = getBackupDir();
  if (existsSync(backupDir)) {
    const backups = readdirSync(backupDir).filter((f) => f.endsWith(".bak"));
    console.log(`  Backups: ${backups.length}`);
  }
}

/**
 * Clean old backups command
 */
export async function cleanBackupsCommand(keep = 10): Promise<void> {
  const backupDir = getBackupDir();

  if (!existsSync(backupDir)) {
    console.log("No backups to clean.");
    return;
  }

  const files = readdirSync(backupDir)
    .filter((f) => f.endsWith(".bak"))
    .map((f) => ({
      name: f,
      path: join(backupDir, f),
      created: statSync(join(backupDir, f)).birthtime,
    }))
    .sort((a, b) => b.created.getTime() - a.created.getTime());

  if (files.length <= keep) {
    console.log(`Only ${files.length} backup(s) found. Nothing to clean.`);
    return;
  }

  const toDelete = files.slice(keep);

  console.log(`\n🧹 Cleaning ${toDelete.length} old backup(s)...\n`);

  for (const file of toDelete) {
    try {
      unlinkSync(file.path);
      console.log(`  Deleted: ${file.name}`);
    } catch (error) {
      console.log(`  Failed to delete: ${file.name} (${error})`);
    }
  }

  console.log(`\n✅ Kept ${keep} most recent backup(s).`);
}
