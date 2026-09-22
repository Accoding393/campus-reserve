import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Create a .env file in the project root.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function addResource(client, collegeId, resource) {
  const [name, type, capacity, building, hasAc, hasProjector, computers, restricted] = resource;
  await client.query(`INSERT INTO resources
    (college_id,name,resource_type,capacity,building,has_ac,has_projector,computer_count,restricted_to_festivals)
    SELECT $1::integer,$2::varchar,$3::varchar,$4::integer,$5::varchar,$6::boolean,$7::boolean,$8::integer,$9::boolean
    WHERE NOT EXISTS (SELECT 1 FROM resources WHERE college_id=$1::integer AND name=$2::varchar)`,
  [collegeId, name, type, capacity, building, hasAc, hasProjector, computers, restricted]);
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

    const adminPassword = await bcrypt.hash('Akshay@1155', 12);
    const sharedPassword = await bcrypt.hash('Welcome@123', 12);
    const collegeResult = await client.query(`INSERT INTO colleges (name, code, city)
      VALUES ('National Institute of Technology Tiruchirappalli', 'NITT', 'Tiruchirappalli')
      ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, city=EXCLUDED.city
      RETURNING id`);
    const nittId = collegeResult.rows[0].id;

    await client.query(`INSERT INTO users (name,email,password_hash,role,college_id)
      VALUES ('Akshay','Akshaypra22@gmail.com',$1,'admin',NULL)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='admin', college_id=NULL`, [adminPassword]);

    await client.query(`INSERT INTO users (name,email,password_hash,role,college_id)
      VALUES ('NITT College Admin','college@nitt.edu',$1,'college',$2)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='college', college_id=$2`, [sharedPassword, nittId]);

    // Keep older dean login working as college-equivalent manager.
    await client.query(`INSERT INTO users (name,email,password_hash,role,college_id)
      VALUES ('NITT Resource Manager','resource.manager@nitt.edu',$1,'college',$2)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='college', college_id=$2`, [sharedPassword, nittId]);

    await client.query(`INSERT INTO users (name,email,password_hash,role,college_id,department,is_club_head)
      VALUES ('NITT Student','student@nitt.edu',$1,'student',$2,'Computer Applications',true)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='student', college_id=$2, department='Computer Applications', is_club_head=true`, [sharedPassword, nittId]);

    await client.query(`INSERT INTO users (name,email,password_hash,role,college_id,department,is_club_head)
      VALUES ('Club Head','clubhead@nitt.edu',$1,'student',$2,'Computer Applications',true)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='student', college_id=$2, department='Computer Applications', is_club_head=true`, [sharedPassword, nittId]);

    await client.query(`INSERT INTO users (name,email,password_hash,role,college_id,department,is_club_head)
      VALUES ('Event Organizer','organizer@nitt.edu',$1,'organizer',$2,'Cultural Affairs',false)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='organizer', college_id=$2, department='Cultural Affairs', is_club_head=false`, [sharedPassword, nittId]);

    await client.query(`INSERT INTO users (name,email,password_hash,role,college_id)
      VALUES ('Campus Guest','guest@nitt.edu',$1,'guest',$2)
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role='guest', college_id=$2`, [sharedPassword, nittId]);

    await client.query(`UPDATE resources SET is_active=false
      WHERE college_id <> $1
         OR name NOT IN ('Third I','Barn Hall','A-Series Hall 5','A-Series Hall 6','A-Series Hall 7','A-Series Hall 8','A-Series Hall 9','A-Series Hall 10','GJCH','MCA/MTech Lab','CEE-SAT Ground')`, [nittId]);
    await client.query(`DELETE FROM colleges WHERE code <> 'NITT'`);

    const nittResources = [
      ['Third I', 'classroom', 100, 'Third I Block', true, true, 100, false],
      ['Barn Hall', 'hall', 500, 'Student Activity Centre', true, true, 0, false],
      ['A-Series Hall 5', 'hall', 100, 'A-Series Block', true, true, 0, false],
      ['A-Series Hall 6', 'hall', 100, 'A-Series Block', true, true, 0, false],
      ['A-Series Hall 7', 'hall', 100, 'A-Series Block', true, true, 0, false],
      ['A-Series Hall 8', 'hall', 100, 'A-Series Block', true, true, 0, false],
      ['A-Series Hall 9', 'hall', 100, 'A-Series Block', true, true, 0, false],
      ['A-Series Hall 10', 'hall', 100, 'A-Series Block', true, true, 0, false],
      ['GJCH', 'hall', 3000, 'GJCH Complex', false, false, 0, false],
      ['MCA/MTech Lab', 'lab', 115, 'Computer Applications Block', true, true, 115, false],
      ['CEE-SAT Ground', 'ground', 10000, 'CEE / SAT Grounds', false, false, 0, true]
    ];
    for (const resource of nittResources) await addResource(client, nittId, resource);

    const resourcesResult = await client.query('SELECT id,name FROM resources WHERE college_id=$1 AND is_active=true', [nittId]);
    const resources = Object.fromEntries(resourcesResult.rows.map((row) => [row.name, row.id]));
    const admin = await client.query("SELECT id FROM users WHERE email='Akshaypra22@gmail.com'");
    const adminId = admin.rows[0].id;
    const existing = await client.query('SELECT 1 FROM events WHERE college_id=$1 LIMIT 1', [nittId]);
    if (!existing.rowCount) {
      await client.query(`INSERT INTO events
        (college_id,title,event_type,description,start_at,end_at,resource_id,priority,guest_visible,created_by) VALUES
        ($1,'Festember 2026','college','Annual cultural festival with stage performances and club showcases.',NOW() + INTERVAL '5 days',NOW() + INTERVAL '5 days 10 hours',$2,'high',true,$3),
        ($1,'Pragyan 2026','college','Student-led technical festival with talks, demonstrations and competitions.',NOW() + INTERVAL '11 days',NOW() + INTERVAL '11 days 9 hours',$2,'high',true,$3),
        ($1,'NITTFest 2026','college','Campus-wide student festival and club showcase.',NOW() + INTERVAL '17 days',NOW() + INTERVAL '17 days 9 hours',$2,'high',true,$3)`,
      [nittId, resources['CEE-SAT Ground'], adminId]);
    }
    await client.query('COMMIT');
    console.log('Ready. Admin: Akshaypra22@gmail.com | College: college@nitt.edu | Student: student@nitt.edu');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
