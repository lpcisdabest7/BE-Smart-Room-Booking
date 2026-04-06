#!/bin/sh
set -e

DB_PATH="${SQLITE_DB_PATH:-/app/data/smart-room-booking.sqlite}"
mkdir -p "$(dirname "$DB_PATH")"

if [ ! -f "$DB_PATH" ]; then
  echo "[entrypoint] First run — seeding database from seed.sql..."
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    const { readFileSync, mkdirSync } = require('node:fs');
    const path = require('node:path');
    const dbPath = process.env.SQLITE_DB_PATH || '/app/data/smart-room-booking.sqlite';
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(readFileSync('/app/seed.sql', 'utf8'));
    db.close();
    console.log('[entrypoint] Seed complete.');
  " 2>/dev/null
else
  echo "[entrypoint] Database exists — skipping seed."
fi

exec node dist/app.js
