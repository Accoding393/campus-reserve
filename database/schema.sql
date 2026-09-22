CREATE TABLE IF NOT EXISTS colleges (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  city VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'college', 'dean', 'hod', 'faculty', 'student', 'organizer', 'guest')),
  college_id INTEGER REFERENCES colleges(id) ON DELETE SET NULL,
  department VARCHAR(120),
  is_club_head BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resources (
  id SERIAL PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  resource_type VARCHAR(30) NOT NULL CHECK (resource_type IN ('auditorium', 'hall', 'classroom', 'lab', 'ground')),
  capacity INTEGER NOT NULL,
  building VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  has_ac BOOLEAN NOT NULL DEFAULT FALSE,
  has_projector BOOLEAN NOT NULL DEFAULT FALSE,
  computer_count INTEGER NOT NULL DEFAULT 0 CHECK (computer_count >= 0),
  restricted_to_festivals BOOLEAN NOT NULL DEFAULT FALSE,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  location_note VARCHAR(220)
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('college', 'department', 'club', 'exam')),
  department VARCHAR(120),
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'rescheduled', 'cancelled')),
  priority VARCHAR(15) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  guest_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_requests (
  id SERIAL PRIMARY KEY,
  college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  request_scope VARCHAR(20) NOT NULL CHECK (request_scope IN ('college', 'department', 'club', 'exam')),
  department VARCHAR(120),
  description TEXT,
  requested_start TIMESTAMPTZ NOT NULL,
  requested_end TIMESTAMPTZ NOT NULL,
  resource_type VARCHAR(30) NOT NULL CHECK (resource_type IN ('auditorium', 'hall', 'classroom', 'lab', 'ground')),
  expected_attendance INTEGER,
  priority VARCHAR(15) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'changes_requested')),
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_resource_id INTEGER REFERENCES resources(id) ON DELETE SET NULL,
  allocation_mode VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (allocation_mode IN ('manual', 'automatic')),
  needs_ac BOOLEAN NOT NULL DEFAULT FALSE,
  needs_projector BOOLEAN NOT NULL DEFAULT FALSE,
  needs_computers BOOLEAN NOT NULL DEFAULT FALSE,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_college_start ON events(college_id, start_at);
CREATE INDEX IF NOT EXISTS idx_requests_college_status ON booking_requests(college_id, status);

-- Safe upgrades for older databases.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'college', 'dean', 'hod', 'faculty', 'student', 'organizer', 'guest'));
ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_resource_type_check;
ALTER TABLE resources ADD CONSTRAINT resources_resource_type_check CHECK (resource_type IN ('auditorium', 'hall', 'classroom', 'lab', 'ground'));
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_resource_type_check;
ALTER TABLE booking_requests ADD CONSTRAINT booking_requests_resource_type_check CHECK (resource_type IN ('auditorium', 'hall', 'classroom', 'lab', 'ground'));
ALTER TABLE resources ADD COLUMN IF NOT EXISTS has_ac BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS has_projector BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS computer_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS restricted_to_festivals BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS location_note VARCHAR(220);
ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_visible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS allocation_mode VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS needs_ac BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS needs_projector BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS needs_computers BOOLEAN NOT NULL DEFAULT FALSE;
