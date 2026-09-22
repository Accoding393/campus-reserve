import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Create a .env file in the project root.');
  process.exit(1);
}

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query('TRUNCATE TABLE booking_requests, events, resources, users, colleges RESTART IDENTITY CASCADE');
  await pool.end();
  const seeded = spawnSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit', env: process.env });
  process.exit(seeded.status ?? 1);
} catch (error) {
  await pool.end();
  console.error(error);
  process.exit(1);
}
