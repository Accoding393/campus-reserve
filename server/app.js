import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { db, query } from './db.js';
import { allowRoles, createToken, requireAuth } from './auth.js';

const app = express();
const port = process.env.PORT || 4000;
const PRIORITY_RANK = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4
};

const __dirname =
  path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, '..', 'client')
  )
);

app.post('/api/directions', requireAuth, allowRoles('student', 'guest'), async (req, res) => {
  try {
    const { origin, destination } = req.body || {};

    const startLat = Number(origin?.latitude);
    const startLon = Number(origin?.longitude);
    const endLat = Number(destination?.latitude);
    const endLon = Number(destination?.longitude);

    if (
      !Number.isFinite(startLat) ||
      !Number.isFinite(startLon) ||
      !Number.isFinite(endLat) ||
      !Number.isFinite(endLon)
    ) {
      return res.status(400).json({
        message: 'Invalid starting location or destination.'
      });
    }

    // Use 'driving' profile for accurate campus routing and 'unlimited' radius to prevent point snapping errors
    const routingUrl =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${startLon},${startLat};${endLon},${endLat}` +
      `?overview=full&geometries=geojson&steps=true&radiuses=unlimited;unlimited`;

    const routingResponse = await fetch(routingUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Campus-Reserve-CRMS/1.0'
      }
    });

    const responseText = await routingResponse.text();

    if (!routingResponse.ok) {
      console.error('OSRM routing error:', routingResponse.status, responseText);
      return res.status(502).json({
        message: 'Walking route service is temporarily unavailable.'
      });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({
        message: 'Invalid response from walking route service.'
      });
    }

    if (data.code !== 'Ok' || !data.routes?.length || !data.routes[0]?.geometry?.coordinates) {
      console.error('OSRM route failure:', JSON.stringify(data, null, 2));
      return res.status(404).json({
        message: 'No walking route could be found.'
      });
    }

    const route = data.routes[0];
    const coordinates = route.geometry.coordinates.map(
      ([longitude, latitude]) => [Number(latitude), Number(longitude)]
    );

    if (coordinates.length < 2) {
      return res.status(404).json({
        message: 'The walking route could not be drawn.'
      });
    }

    console.log(`Route found: ${coordinates.length} points, ${(route.distance / 1000).toFixed(3)} km`);

    return res.json({
      coordinates,
      distanceKm: Number((route.distance / 1000).toFixed(3)),
      timeMinutes: Math.round(route.duration / 60)
    });

  } catch (error) {
    console.error('Directions server error:', error);
    return res.status(500).json({
      message: 'Unable to calculate the walking route.'
    });
  }
});

const userFields = `u.id, u.name, u.email, u.role, u.college_id, u.department, u.is_club_head,
  c.name AS college_name, c.code AS college_code`;

function isCollegeManager(role) {
  return role === 'college' || role === 'dean';
}

function canManageCollege(req, collegeId) {
  return req.user.role === 'admin' || (isCollegeManager(req.user.role) && Number(req.user.collegeId) === Number(collegeId));
}

function eventAccess(req, collegeId) {
  return req.user.role === 'admin' || Number(req.user.collegeId) === Number(collegeId);
}

function canUseLocationService(role) {
  return ['student', 'guest'].includes(role);
}

function canManageVenueMap(role) {
  return ['admin', 'college', 'dean'].includes(role);
}

function canSeeVenueCoordinates(req) {
  return canUseLocationService(req.user.role) || canManageVenueMap(req.user.role);
}

function parseVenueCoordinates(latitude, longitude) {
  const hasLatitude = latitude !== undefined && latitude !== null && latitude !== '';
  const hasLongitude = longitude !== undefined && longitude !== null && longitude !== '';
  if (!hasLatitude && !hasLongitude) return { latitude: null, longitude: null };
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (!hasLatitude || !hasLongitude || !Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)
    || parsedLatitude < -90 || parsedLatitude > 90 || parsedLongitude < -180 || parsedLongitude > 180) {
    return null;
  }
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

function isValidWindow(start, end) {
  return start && end && new Date(start) < new Date(end);
}

function isFestivalGroundEvent(title = '') {
  return ['festember', 'nittfest', 'pragyan'].some((festival) => title.toLowerCase().includes(festival));
}

function canUseResource(resource, title) {
  return !resource.restricted_to_festivals || isFestivalGroundEvent(title);
}

function asBool(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

async function getConflicts(resourceId, startAt, endAt, excludeEventId = null) {
  if (!resourceId) return [];
  const params = [resourceId, startAt, endAt];
  let exclusion = '';
  if (excludeEventId) {
    params.push(excludeEventId);
    exclusion = ' AND id <> $4';
  }
  const result = await query(`SELECT id, title, priority FROM events
    WHERE resource_id=$1 AND status <> 'cancelled' AND start_at < $3 AND end_at > $2${exclusion}`, params);
  return result.rows;
}

async function resourceIsAvailable(resourceId, startAt, endAt, excludeEventId = null) {
  return (await getConflicts(resourceId, startAt, endAt, excludeEventId)).length === 0;
}

async function allocateResourceSlot({ resourceId, startAt, endAt, priority = 'normal', excludeEventId = null, allowPriorityOverride = false }) {
  const conflicts = await getConflicts(resourceId, startAt, endAt, excludeEventId);
  if (!conflicts.length) return { ok: true, displaced: [] };

  if (!allowPriorityOverride) {
    return { ok: false, message: 'That resource is already booked for this time window.' };
  }

  const incomingRank = PRIORITY_RANK[priority] || 2;
  const blocking = conflicts.filter((event) => incomingRank <= (PRIORITY_RANK[event.priority] || 2));
  if (blocking.length) {
    return {
      ok: false,
      message: `Cannot override "${blocking[0].title}" (${blocking[0].priority} priority). Raise priority above the current booking to reallocate.`
    };
  }

  const ids = conflicts.map((event) => event.id);
  await query(`UPDATE events SET status='cancelled', updated_at=NOW()
    WHERE id = ANY($1::int[])`, [ids]);
  return { ok: true, displaced: conflicts };
}

async function findAutomaticResource({ collegeId, resourceType, requestedStart, requestedEnd, expectedAttendance, needsAc, needsProjector, needsComputers, title }) {
  const attendance = Number(expectedAttendance) || 1;
  const minimumCapacity = Math.ceil(attendance / 1.05);
  const result = await query(`SELECT r.* FROM resources r
    WHERE r.college_id=$1 AND r.is_active=true AND r.resource_type=$2
      AND r.capacity >= $3
      AND ($4::boolean=false OR r.has_ac=true)
      AND ($5::boolean=false OR r.has_projector=true)
      AND ($6::boolean=false OR r.computer_count >= $3)
      AND r.restricted_to_festivals=false
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.resource_id=r.id AND e.status <> 'cancelled' AND e.start_at < $8 AND e.end_at > $7)
    ORDER BY r.capacity ASC, r.computer_count ASC, r.name ASC`, [collegeId, resourceType, minimumCapacity, needsAc, needsProjector, needsComputers, requestedStart, requestedEnd]);
  return result.rows.find((resource) => canUseResource(resource, title)) || null;
}

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Enter your email and password.' });
    const result = await query(`SELECT ${userFields}, u.password_hash FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE LOWER(u.email) = LOWER($1)`, [email.trim()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Incorrect email or password.' });
    }
    delete user.password_hash;
    res.json({ token: createToken(user), user });
  } catch (error) { next(error); }
});

app.get('/api/guest/colleges', async (_req, res, next) => {
  try {
    const result = await query('SELECT id, name, city FROM colleges ORDER BY name');
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/auth/guest-register', async (req, res, next) => {
  try {
    const { name, email, password, collegeId } = req.body;
    if (!name?.trim() || !email?.trim() || !password || !collegeId) {
      return res.status(400).json({ message: 'Name, email, password, and college are required.' });
    }
    if (password.length < 8) return res.status(400).json({ message: 'Use a password with at least 8 characters.' });
    const college = await query('SELECT id FROM colleges WHERE id=$1', [collegeId]);
    if (!college.rowCount) return res.status(400).json({ message: 'Choose a valid college.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const created = await query(`INSERT INTO users (name,email,password_hash,role,college_id)
      VALUES ($1,$2,$3,'guest',$4)
      RETURNING id,name,email,role,college_id,department,is_club_head`,
    [name.trim(), email.trim().toLowerCase(), passwordHash, collegeId]);
    const user = created.rows[0];
    const userResult = await query(`SELECT ${userFields} FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE u.id=$1`, [user.id]);
    res.status(201).json({ token: createToken(user), user: userResult.rows[0] });
  } catch (error) {
    error.code === '23505' ? res.status(409).json({ message: 'An account already uses that email address.' }) : next(error);
  }
});

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const result = await query(`SELECT ${userFields} FROM users u LEFT JOIN colleges c ON c.id=u.college_id WHERE u.id = $1`, [req.user.id]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/colleges', requireAuth, async (req, res, next) => {
  try {
    const params = [];
    const scope = req.user.role === 'admin' ? '' : 'WHERE c.id = $1';
    if (scope) params.push(req.user.collegeId);
    const result = await query(`SELECT c.*,
      (SELECT COUNT(*)::int FROM events e WHERE e.college_id=c.id AND e.status <> 'cancelled') AS event_count,
      (SELECT COUNT(*)::int FROM resources r WHERE r.college_id=c.id AND r.is_active=true) AS resource_count,
      manager.name AS dean_name, manager.email AS dean_email
      FROM colleges c
      LEFT JOIN LATERAL (
        SELECT name, email FROM users WHERE college_id=c.id AND role IN ('college','dean') ORDER BY CASE role WHEN 'college' THEN 0 ELSE 1 END, id LIMIT 1
      ) manager ON TRUE ${scope} ORDER BY c.name`, params);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/colleges', requireAuth, allowRoles('admin'), async (req, res, next) => {
  const client = await db.connect();
  try {
    const { name, code, city, deanName, deanEmail, deanPassword } = req.body;
    if (!name || !code || !deanName || !deanEmail || !deanPassword) {
      return res.status(400).json({ message: 'College details plus the college account name, email, and password are required.' });
    }
    if (deanPassword.length < 8) return res.status(400).json({ message: 'Use at least 8 characters for the college account password.' });
    await client.query('BEGIN');
    const college = await client.query('INSERT INTO colleges (name,code,city) VALUES ($1,$2,$3) RETURNING *', [name.trim(), code.trim().toUpperCase(), city?.trim() || null]);
    const passwordHash = await bcrypt.hash(deanPassword, 12);
    const manager = await client.query(`INSERT INTO users (name,email,password_hash,role,college_id)
      VALUES ($1,$2,$3,'college',$4) RETURNING id,name,email,role,college_id`, [deanName.trim(), deanEmail.trim().toLowerCase(), passwordHash, college.rows[0].id]);
    await client.query('COMMIT');
    res.status(201).json({ ...college.rows[0], dean_name: manager.rows[0].name, dean_email: manager.rows[0].email });
  } catch (error) {
    await client.query('ROLLBACK');
    error.code === '23505' ? res.status(409).json({ message: 'That college code or email address already exists.' }) : next(error);
  } finally { client.release(); }
});

app.get('/api/resources', requireAuth, async (req, res, next) => {
  try {
    const collegeId = req.query.collegeId || req.user.collegeId;
    if (!collegeId || !eventAccess(req, collegeId)) return res.status(403).json({ message: 'Select a college you can access.' });
    const coordinateFields = canSeeVenueCoordinates(req)
      ? 'r.latitude, r.longitude, r.location_note'
      : 'NULL::numeric AS latitude, NULL::numeric AS longitude, NULL::varchar AS location_note';
    const result = await query(`SELECT r.id, r.college_id, r.name, r.resource_type, r.capacity, r.building, r.is_active,
      r.has_ac, r.has_projector, r.computer_count, r.restricted_to_festivals, ${coordinateFields}
      FROM resources r WHERE r.college_id=$1 AND r.is_active=true ORDER BY r.resource_type,r.name`, [collegeId]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/resources', requireAuth, allowRoles('admin', 'college', 'dean'), async (req, res, next) => {
  try {
    const { collegeId, name, resourceType, capacity, building, hasAc, hasProjector, computerCount, restrictedToFestivals, latitude, longitude, locationNote } = req.body;
    const targetCollege = collegeId || req.user.collegeId;
    if (!targetCollege || !canManageCollege(req, targetCollege)) return res.status(403).json({ message: 'You can only manage venues for your college.' });
    if (!name || !resourceType || !capacity) return res.status(400).json({ message: 'Venue name, type and capacity are required.' });
    if (!['auditorium', 'hall', 'classroom', 'lab', 'ground'].includes(resourceType)) return res.status(400).json({ message: 'Choose a valid resource type.' });
    const coordinates = parseVenueCoordinates(latitude, longitude);
    if (!coordinates) return res.status(400).json({ message: 'Enter a valid latitude and longitude, or leave both empty and pin the venue later.' });
    const result = await query(`INSERT INTO resources (college_id,name,resource_type,capacity,building,has_ac,has_projector,computer_count,restricted_to_festivals,latitude,longitude,location_note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [targetCollege, name.trim(), resourceType, Number(capacity), building?.trim() || null, asBool(hasAc), asBool(hasProjector), Number(computerCount) || 0, asBool(restrictedToFestivals), coordinates.latitude, coordinates.longitude, locationNote?.trim() || null]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.patch('/api/resources/:id/location', requireAuth, allowRoles('admin', 'college', 'dean'), async (req, res, next) => {
  try {
    const resourceResult = await query('SELECT id, college_id FROM resources WHERE id=$1', [req.params.id]);
    const resource = resourceResult.rows[0];
    if (!resource) return res.status(404).json({ message: 'Venue not found.' });
    if (!canManageCollege(req, resource.college_id)) return res.status(403).json({ message: 'You can only pin venues for your college.' });
    const coordinates = parseVenueCoordinates(req.body.latitude, req.body.longitude);
    if (!coordinates) return res.status(400).json({ message: 'Choose a valid point on the map.' });
    if (coordinates.latitude === null) return res.status(400).json({ message: 'Choose a point on the map before saving.' });
    const result = await query(`UPDATE resources SET latitude=$1, longitude=$2, location_note=$3 WHERE id=$4 RETURNING *`,
      [coordinates.latitude, coordinates.longitude, req.body.locationNote?.trim() || null, resource.id]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.get('/api/events', requireAuth, async (req, res, next) => {
  try {
    const collegeId = req.query.collegeId || req.user.collegeId;
    if (!collegeId || !eventAccess(req, collegeId)) return res.status(403).json({ message: 'You cannot access this college.' });
    const result = await query(`SELECT e.*, c.name AS college_name, r.name AS resource_name, r.resource_type, r.building AS resource_building, r.capacity AS resource_capacity,
      creator.name AS created_by_name FROM events e JOIN colleges c ON c.id=e.college_id
      LEFT JOIN resources r ON r.id=e.resource_id LEFT JOIN users creator ON creator.id=e.created_by
      WHERE e.college_id=$1 AND e.status <> 'cancelled' ORDER BY e.start_at ASC`, [collegeId]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

app.post('/api/events', requireAuth, allowRoles('admin', 'college', 'dean'), async (req, res, next) => {
  try {
    const { collegeId, title, eventType, department, description, startAt, endAt, resourceId, priority, guestVisible } = req.body;
    const targetCollege = collegeId || req.user.collegeId;
    if (!targetCollege || !canManageCollege(req, targetCollege)) return res.status(403).json({ message: 'You cannot add an event to this college.' });
    if (!title || !eventType || !isValidWindow(startAt, endAt)) return res.status(400).json({ message: 'Provide a title, event type, and valid start/end time.' });
    const resourceCheck = resourceId ? await query('SELECT * FROM resources WHERE id=$1 AND college_id=$2', [resourceId, targetCollege]) : { rowCount: 1 };
    if (!resourceCheck.rowCount) return res.status(400).json({ message: 'Selected resource does not belong to this college.' });
    if (resourceId && !canUseResource(resourceCheck.rows[0], title)) return res.status(403).json({ message: 'CEE-SAT Ground is reserved only for Festember, NITTFest, and Pragyan.' });
    const slot = await allocateResourceSlot({
      resourceId,
      startAt,
      endAt,
      priority: priority || 'normal',
      allowPriorityOverride: true
    });
    if (!slot.ok) return res.status(409).json({ message: slot.message });
    const result = await query(`INSERT INTO events (college_id,title,event_type,department,description,start_at,end_at,resource_id,priority,guest_visible,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [targetCollege, title.trim(), eventType, department || req.user.department || null, description || null, startAt, endAt, resourceId || null, priority || 'normal', asBool(guestVisible), req.user.id]);
    res.status(201).json({ ...result.rows[0], displaced: slot.displaced });
  } catch (error) { next(error); }
});

app.patch('/api/events/:id', requireAuth, allowRoles('admin', 'college', 'dean'), async (req, res, next) => {
  try {
    const existing = await query('SELECT * FROM events WHERE id=$1', [req.params.id]);
    const event = existing.rows[0];
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    if (!canManageCollege(req, event.college_id)) return res.status(403).json({ message: 'You cannot change this event.' });
    const { startAt, endAt, resourceId, priority, status, guestVisible } = req.body;
    if ((startAt || endAt) && !isValidWindow(startAt || event.start_at, endAt || event.end_at)) return res.status(400).json({ message: 'The new time window is invalid.' });
    const nextResourceId = resourceId || event.resource_id;
    const nextStart = startAt || event.start_at;
    const nextEnd = endAt || event.end_at;
    const nextPriority = priority || event.priority;
    if (nextResourceId) {
      const nextResource = await query('SELECT * FROM resources WHERE id=$1 AND college_id=$2', [nextResourceId, event.college_id]);
      if (!nextResource.rowCount) return res.status(400).json({ message: 'Selected resource does not belong to this college.' });
      if (!canUseResource(nextResource.rows[0], event.title)) return res.status(403).json({ message: 'CEE-SAT Ground is reserved only for Festember, NITTFest, and Pragyan.' });
    }
    const slot = await allocateResourceSlot({
      resourceId: nextResourceId,
      startAt: nextStart,
      endAt: nextEnd,
      priority: nextPriority,
      excludeEventId: event.id,
      allowPriorityOverride: true
    });
    if (!slot.ok) return res.status(409).json({ message: slot.message });
    const nextGuestVisible = guestVisible === undefined ? null : asBool(guestVisible);
    const nextStatus = status || ((startAt || endAt || resourceId || priority) ? 'rescheduled' : null);
    const result = await query(`UPDATE events SET start_at=COALESCE($1,start_at), end_at=COALESCE($2,end_at), resource_id=COALESCE($3,resource_id),
      priority=COALESCE($4,priority), status=COALESCE($5,status), guest_visible=COALESCE($6,guest_visible), updated_at=NOW() WHERE id=$7 RETURNING *`, [startAt || null, endAt || null, resourceId || null, priority || null, nextStatus, nextGuestVisible, event.id]);
    res.json({ ...result.rows[0], displaced: slot.displaced });
  } catch (error) { next(error); }
});

app.delete('/api/events/:id', requireAuth, allowRoles('admin', 'college', 'dean'), async (req, res, next) => {
  try {
    const existing = await query('SELECT college_id FROM events WHERE id=$1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ message: 'Event not found.' });
    if (!canManageCollege(req, existing.rows[0].college_id)) return res.status(403).json({ message: 'You cannot remove this event.' });
    await query("UPDATE events SET status='cancelled', updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/requests', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'guest') return res.json([]);
    let where = '';
    const params = [];
    if (['student', 'organizer'].includes(req.user.role)) {
      where = 'WHERE b.requester_id=$1';
      params.push(req.user.id);
    } else if (req.user.role !== 'admin') {
      where = 'WHERE b.college_id=$1';
      params.push(req.user.collegeId);
    }
    const result = await query(`SELECT b.*, c.name AS college_name, requester.name AS requester_name, requester.email AS requester_email,
      r.name AS assigned_resource_name, reviewer.name AS reviewer_name FROM booking_requests b
      JOIN colleges c ON c.id=b.college_id JOIN users requester ON requester.id=b.requester_id
      LEFT JOIN resources r ON r.id=b.assigned_resource_id LEFT JOIN users reviewer ON reviewer.id=b.reviewed_by
      ${where} ORDER BY CASE b.status WHEN 'pending' THEN 0 ELSE 1 END, b.requested_start ASC`, params);
    const scoped = req.user.role === 'hod'
      ? result.rows.filter((row) => ['department', 'exam', 'club'].includes(row.request_scope) && (!row.department || row.department === req.user.department))
      : req.user.role === 'faculty'
        ? result.rows.filter((row) => Number(row.requester_id) === Number(req.user.id))
        : result.rows;
    res.json(scoped);
  } catch (error) { next(error); }
});

app.post('/api/requests', requireAuth, allowRoles('student', 'organizer'), async (req, res, next) => {
  try {
    const { title, requestScope, department, description, requestedStart, requestedEnd, resourceType, expectedAttendance, priority, allocationMode = 'manual', needsAc = false, needsProjector = false, needsComputers = false } = req.body;
    if (!title || !requestScope || !resourceType || !isValidWindow(requestedStart, requestedEnd)) return res.status(400).json({ message: 'Complete the title, scope, resource type, and time window.' });
    if (!req.user.collegeId) return res.status(400).json({ message: 'Your account is not linked to a college.' });
    if (!['club', 'college'].includes(requestScope)) return res.status(400).json({ message: 'Students can request club events or normal college events (for example company seminars).' });
    if (!['manual', 'automatic'].includes(allocationMode)) return res.status(400).json({ message: 'Choose automatic or manual allocation.' });
    if (!expectedAttendance) return res.status(400).json({ message: 'Enter the expected attendance / capacity needed.' });
    if (resourceType === 'ground' && !isFestivalGroundEvent(title)) {
      return res.status(403).json({ message: 'CEE-SAT Ground is reserved only for Festember, NITTFest, and Pragyan.' });
    }

    const requirements = {
      collegeId: req.user.collegeId,
      resourceType,
      requestedStart,
      requestedEnd,
      expectedAttendance,
      needsAc: asBool(needsAc),
      needsProjector: asBool(needsProjector),
      needsComputers: asBool(needsComputers),
      title: title.trim()
    };

    let suggested = null;
    let note = null;
    if (allocationMode === 'automatic') {
      if (!asBool(needsAc) && !asBool(needsProjector) && !asBool(needsComputers) && !expectedAttendance) {
        return res.status(400).json({ message: 'For automatic allocation, set capacity and facility requirements.' });
      }
      suggested = await findAutomaticResource(requirements);
      note = suggested
        ? `Automatic suggestion: ${suggested.name}. Waiting for college approval.`
        : 'No matching venue was free for automatic allocation. College will allocate manually.';
    } else {
      note = 'Manual request submitted. College will choose and allocate a venue.';
    }

    const result = await query(`INSERT INTO booking_requests (college_id,title,request_scope,department,description,requested_start,requested_end,resource_type,expected_attendance,priority,requester_id,allocation_mode,needs_ac,needs_projector,needs_computers,status,assigned_resource_id,review_note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',$16,$17) RETURNING *`, [
      req.user.collegeId, title.trim(), requestScope, department || req.user.department || null, description || null,
      requestedStart, requestedEnd, resourceType, Number(expectedAttendance) || null, priority || 'normal', req.user.id,
      allocationMode, requirements.needsAc, requirements.needsProjector, requirements.needsComputers, suggested?.id || null, note
    ]);

    res.status(201).json({
      ...result.rows[0],
      assigned_resource_name: suggested?.name || null,
      automaticSuggestion: Boolean(suggested)
    });
  } catch (error) { next(error); }
});

app.patch('/api/requests/:id', requireAuth, allowRoles('admin', 'college', 'dean', 'hod'), async (req, res, next) => {
  try {
    const existing = await query('SELECT * FROM booking_requests WHERE id=$1', [req.params.id]);
    const request = existing.rows[0];
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (!eventAccess(req, request.college_id)) return res.status(403).json({ message: 'You cannot review this request.' });
    if (req.user.role === 'hod' && (!['department', 'exam', 'club'].includes(request.request_scope) || (request.department && request.department !== req.user.department))) {
      return res.status(403).json({ message: 'This request is outside your department.' });
    }
    if (request.status !== 'pending') return res.status(409).json({ message: 'This request has already been reviewed.' });
    const { status, resourceId, note } = req.body;
    if (!['approved', 'declined', 'changes_requested'].includes(status)) return res.status(400).json({ message: 'Choose an approval outcome.' });
    const chosenResourceId = resourceId || (status === 'approved' ? request.assigned_resource_id : null);
    if (status === 'approved' && !chosenResourceId) return res.status(400).json({ message: 'Assign a resource before approving.' });
    if (chosenResourceId) {
      const resource = await query('SELECT * FROM resources WHERE id=$1 AND college_id=$2', [chosenResourceId, request.college_id]);
      if (!resource.rowCount) return res.status(400).json({ message: 'Selected resource is invalid.' });
      if (resource.rows[0].resource_type !== request.resource_type) return res.status(400).json({ message: 'Resource type must match the request.' });
      if (!canUseResource(resource.rows[0], request.title)) return res.status(403).json({ message: 'CEE-SAT Ground is reserved only for Festember, NITTFest, and Pragyan.' });
      if (status === 'approved') {
        const slot = await allocateResourceSlot({
          resourceId: chosenResourceId,
          startAt: request.requested_start,
          endAt: request.requested_end,
          priority: request.priority,
          allowPriorityOverride: isCollegeManager(req.user.role) || req.user.role === 'admin'
        });
        if (!slot.ok) return res.status(409).json({ message: slot.message });
      }
    }
    await query(`UPDATE booking_requests SET status=$1, assigned_resource_id=$2, review_note=$3, reviewed_by=$4, updated_at=NOW() WHERE id=$5`,
      [status, chosenResourceId || null, note || null, req.user.id, request.id]);
    if (status === 'approved') {
      await query(`INSERT INTO events (college_id,title,event_type,department,description,start_at,end_at,resource_id,priority,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [request.college_id, request.title, request.request_scope, request.department, request.description, request.requested_start, request.requested_end, chosenResourceId, request.priority, request.requester_id]);
    }
    res.json({ message: `Request ${status.replace('_', ' ')}.` });
  } catch (error) { next(error); }
});

app.get('/api/dashboard', requireAuth, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const isGuest = req.user.role === 'guest';
    const id = req.user.collegeId;
    const [events, pending, resources, upcoming] = await Promise.all([
      query(`SELECT COUNT(*)::int AS count FROM events ${isAdmin ? '' : "WHERE college_id=$1 AND status <> 'cancelled'"}`, isAdmin ? [] : [id]),
      query(`SELECT COUNT(*)::int AS count FROM booking_requests ${isAdmin ? "WHERE status='pending'" : (isGuest ? 'WHERE false' : "WHERE college_id=$1 AND status='pending'")}`, isAdmin || isGuest ? [] : [id]),
      query(`SELECT COUNT(*)::int AS count FROM resources ${isAdmin ? 'WHERE is_active=true' : 'WHERE college_id=$1 AND is_active=true'}`, isAdmin ? [] : [id]),
      query(`SELECT e.title,e.start_at,e.event_type,e.priority,r.name AS resource_name,c.name AS college_name FROM events e
        JOIN colleges c ON c.id=e.college_id LEFT JOIN resources r ON r.id=e.resource_id
        WHERE e.status <> 'cancelled' AND e.start_at >= NOW() ${isAdmin ? '' : 'AND e.college_id=$1'} ORDER BY e.start_at LIMIT 5`, isAdmin ? [] : [id])
    ]);
    res.json({ metrics: { scheduledEvents: events.rows[0].count, pendingRequests: pending.rows[0].count, resources: resources.rows[0].count }, upcoming: upcoming.rows });
  } catch (error) { next(error); }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
});
app.listen(port, '0.0.0.0', () => {
  console.log(`Campus Reserve is running on port ${port}`);
});