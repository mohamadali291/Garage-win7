#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const sourceArg = process.argv[2];
const targetArg = process.argv[3];

if (!sourceArg) {
  console.error("Usage: node backend/scripts/import-legacy-db.js <legacy-db-path> [target-db-path]");
  process.exit(1);
}

const sourcePath = path.resolve(sourceArg);
if (!fs.existsSync(sourcePath)) {
  console.error(`Legacy DB not found: ${sourcePath}`);
  process.exit(1);
}

const targetPath = path.resolve(
  targetArg || path.join(__dirname, "..", "data", "garage.sqlite")
);

process.env.DB_PATH = targetPath;
const { VALID_COLLECTIONS, getDb } = require("../src/db");

const sourceDb = new Database(sourcePath, { readonly: true });
const targetDb = getDb();

function tableExists(db, name) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return !!row;
}

function readCollection(db, name) {
  if (!tableExists(db, name)) return [];
  const rows = db.prepare(`SELECT data FROM "${name}" ORDER BY rowid`).all();
  return rows
    .map((row) => {
      try {
        return JSON.parse(row.data);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

function writeCollection(db, name, items) {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS "${name}" (id TEXT PRIMARY KEY, data TEXT NOT NULL)`
  ).run();

  const clear = db.prepare(`DELETE FROM "${name}"`);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO "${name}" (id, data) VALUES (?, ?)`
  );

  const tx = db.transaction(() => {
    clear.run();
    items.forEach((item) => {
      const id = item && item.id != null ? item.id : Date.now();
      insert.run(String(id), JSON.stringify({ ...item, id }));
    });
  });

  tx();
  return items.length;
}

const summary = {};

VALID_COLLECTIONS.forEach((collection) => {
  const items = readCollection(sourceDb, collection);
  summary[collection] = writeCollection(targetDb, collection, items);
});

sourceDb.close();

console.log("Import complete.");
console.log("Source:", sourcePath);
console.log("Target:", targetPath);
console.log("Imported counts:", summary);
