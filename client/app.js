const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');
const state = {
  token: localStorage.getItem('campus_token'),
  user: null,
  view: 'overview',
  dashboard: null,
  colleges: [],
  events: [],
  requests: [],
  resources: [],
  selectedCollegeId: null,
  calendarCursor: new Date(),
  selectedCalendarDate: null,
  mapRoute: null,
  guestJustCreated: false,
  eventsBound: false,
  routeWatchId: null
};

const roleLabels = {
  admin: 'Platform Administrator',
  college: 'College Admin',
  dean: 'College Admin',
  hod: 'Head of Department',
  faculty: 'Faculty',
  student: 'Student',
  organizer: 'Event Organizer',
  guest: 'Guest visitor'
};
const icon = { overview: '◫', colleges: '⌂', events: '◷', requests: '↗', resources: '▦', map: '⌖' };
const NITT_MAIN_GATE = { latitude: 10.756867, longitude: 78.813100, label: 'NITT Main Gate' };
let activeCampusMap = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
function titleCase(value = '') { return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function initials(name = '') { return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase(); }
function formatDate(date, options = { day: 'numeric', month: 'short', year: 'numeric' }) { return new Intl.DateTimeFormat('en-IN', options).format(new Date(date)); }
function formatDateTime(date) { return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(date)); }
function localDateTime(date = new Date()) { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16); }
// TIMEZONE FIX: Convert a datetime-local value (user's local time)
// into an ISO UTC timestamp before sending to the server.
// Example: 27 Sep 2026 11:59 PM IST -> 2026-09-27T18:29:00.000Z
function localDateTimeToISO(value) {
  if (!value) return value;
  return new Date(value).toISOString();
}
function dateKey(date) { const local = new Date(date); return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`; }
function displayMonth(date) { return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(date); }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function calendarEventsFor(date) { const key = typeof date === 'string' ? date : dateKey(date); return state.events.filter((event) => dateKey(event.start_at) === key && event.status !== 'cancelled'); }
function tag(value) { return `<span class="tag ${escapeHtml(value)}">${escapeHtml(titleCase(value))}</span>`; }
function can(...roles) { return roles.includes(state.user?.role); }
function isAllocator() { return can('admin', 'college', 'dean'); }
function isRequester() { return can('student', 'organizer'); }
function isGuest() { return can('guest'); }
function isLocationViewer() { return can('student', 'guest'); }
function hasCoordinates(resource) {
  return resource?.latitude !== null && resource?.latitude !== undefined && resource?.latitude !== ''
    && resource?.longitude !== null && resource?.longitude !== undefined && resource?.longitude !== ''
    && Number.isFinite(Number(resource.latitude)) && Number.isFinite(Number(resource.longitude));
}
function venueForEvent(event) { return state.resources.find((resource) => Number(resource.id) === Number(event.resource_id)); }
function toast(message, type = '') {
  const element = document.createElement('div');

  element.className = `toast ${type}`;
  element.textContent = String(message || '');

  const region =
    document.querySelector('#toast-region') ||
    document.body;

  region.appendChild(element);

  setTimeout(() => {
    if (element && element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }, 3600);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) }
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'The request could not be completed.');
  return data;
}

function logout() {
  localStorage.removeItem('campus_token');
  state.token = null;
  state.user = null;
  state.view = 'overview';
  state.dashboard = null;
  state.colleges = [];
  state.events = [];
  state.requests = [];
  state.resources = [];
  state.selectedCollegeId = null;
  state.mapRoute = null;
  state.guestJustCreated = false;
  if (state.routeWatchId !== null && navigator.geolocation && navigator.geolocation.clearWatch) {
    navigator.geolocation.clearWatch(state.routeWatchId);
  }
  state.routeWatchId = null;
  render();
  toast('Signed out.');
}

function loginTemplate() {
  return `<section class="login-page">
    <div class="login-form-wrap"><form class="login-form" id="login-form">
      <div class="wordmark"><span class="brand-mark">C</span><span>Campus Reserve</span></div>
      <h1>Welcome back</h1>
      <p>Sign in to coordinate spaces, schedules and campus events with your team.</p>
      <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="name@college.edu" required /></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required /></div>
      <button class="btn btn-primary btn-full" type="submit">Sign in to workspace</button>
      <button class="btn btn-primary btn-full" type="button" data-guest-login>Continue as guest</button>
      <button class="btn btn-secondary btn-full local-admin-login" type="button" id="local-admin-login">Use local administrator account</button>
      <div class="credential-note"><strong>Demo accounts</strong><br>Admin: Akshaypra22@gmail.com / Akshay@1155<br>College: college@nitt.edu / Welcome@123<br>Student: student@nitt.edu / Welcome@123<br>Guest: guest@nitt.edu / Welcome@123</div>
    </form></div>
    <aside class="login-visual"><div class="visual-caption"><div class="eyebrow">College Resource Management</div><h2>Every space, planned with clarity.</h2><p>One calm place to manage auditoriums, halls, classrooms and labs—without the timetable chaos.</p></div></aside>
  </section>`;
}

function navigation() {
  const nav = [{ id: 'overview', label: 'Overview' }];
  if (can('admin')) {
    nav.push({ id: 'colleges', label: 'Colleges' }, { id: 'events', label: 'Booking calendar' }, { id: 'requests', label: 'Request queue' }, { id: 'resources', label: 'Venues' }, { id: 'map', label: 'Campus map' });
  } else if (isAllocator()) {
    nav.push({ id: 'events', label: 'Booking calendar' }, { id: 'requests', label: 'Request queue' }, { id: 'resources', label: 'Venues' }, { id: 'map', label: 'Campus map' });
  } else if (isGuest()) {
    nav.push({ id: 'events', label: 'Public events' }, { id: 'resources', label: 'Venues' }, { id: 'map', label: 'Campus map' });
  } else {
    nav.push({ id: 'events', label: 'Schedule' }, { id: 'requests', label: 'My requests' }, { id: 'resources', label: 'Resources' });
    if (can('student')) nav.push({ id: 'map', label: 'Campus map' });
  }
  return nav.map((item) => `<button type="button" class="nav-item ${state.view === item.id ? 'active' : ''}" data-view="${item.id}"><span class="nav-icon">${icon[item.id]}</span><span>${item.label}</span></button>`).join('');
}

function shellTemplate(content) {
  return `<section class="shell"><aside class="sidebar">
    <div class="wordmark"><span class="brand-mark">C</span><span>Campus Reserve</span></div>
    <div class="workspace-label">Workspace</div><nav class="nav-list">${navigation()}</nav>
    <div class="side-user">
      <div class="avatar">${initials(state.user.name)}</div>
      <div class="side-user-meta"><div class="name">${escapeHtml(state.user.name)}</div><div class="role">${escapeHtml(roleLabels[state.user.role] || state.user.role)}</div></div>
      <button type="button" class="btn btn-logout" data-logout title="Log out">Log out</button>
    </div>
  </aside><main class="content">${content}</main></section>`;
}

function header(title, eyebrow, action = '') {
  return `<header class="topbar"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${escapeHtml(title)}</h1></div><div class="topbar-actions"><span class="role-pill">${escapeHtml(state.user.role)}</span>${action}<button type="button" class="btn btn-secondary btn-logout-top" data-logout>Log out</button></div></header>`;
}

function metric(label, value, note) { return `<article class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`; }

function renderOverview() {
  const dashboard = state.dashboard || { metrics: {}, upcoming: [] };
  const defaultTitle = state.user.role === 'admin' ? 'All campuses at a glance' : (state.user.college_name || 'Campus workspace');
  const requestAction = isRequester() ? '<button type="button" class="btn btn-primary" data-modal="request">New booking request</button>' : '';
  const events = dashboard.upcoming.length ? dashboard.upcoming.map((event) => `<div class="event-row"><div class="date-tile">${formatDate(event.start_at, { day: '2-digit', month: 'short' }).replace(' ', '<br>')}</div><div><div class="event-name">${escapeHtml(event.title)}</div><div class="event-meta">${escapeHtml(event.resource_name || 'Venue to be assigned')} · ${escapeHtml(event.college_name)}</div></div>${tag(event.event_type)}</div>`).join('') : '<div class="empty">Nothing is scheduled yet.</div>';
  const queue = state.requests.filter((request) => request.status === 'pending').slice(0, 4);
  const queueItems = queue.length ? queue.map((request) => `<div class="queue-item"><div class="queue-title">${escapeHtml(request.title)}</div><div class="queue-meta">${tag(request.request_scope)} <span>·</span><span>${formatDate(request.requested_start)}</span></div></div>`).join('') : '<div class="empty">No pending requests.</div>';
  const managerMetrics = `${metric('Scheduled events', dashboard.metrics.scheduledEvents ?? '—', 'Campus calendar')}${metric('Pending requests', dashboard.metrics.pendingRequests ?? '—', isRequester() ? 'Awaiting college approval' : 'Student requests awaiting action')}${metric('Active venues', dashboard.metrics.resources ?? '—', 'Rooms, halls, lab and ground')}`;
  if (isGuest()) {
    return shellTemplate(`${header(defaultTitle, 'Guest event pass')}
      ${state.guestJustCreated ? '<div class="success-banner" role="status">Guest account created successfully. You can now view events and use venue directions.</div>' : ''}
      <section class="metric-grid">${metric('College events', dashboard.metrics.scheduledEvents ?? '—', 'All active events for this college')}${metric('Active venues', dashboard.metrics.resources ?? '—', 'Venue pins are maintained by the college')}${metric('Directions', 'Ready', 'Use your current location when you need to travel')}</section>
      <section class="dashboard-grid dashboard-single"><article class="card"><div class="card-head"><div><div class="card-title">Upcoming public events</div><div class="card-subtitle">Details and venue directions for registered guests.</div></div><button type="button" class="text-button" data-view="events">View events</button></div><div class="event-list">${events}</div></article></section>`);
  }
  const dashboardContent = isAllocator() || can('admin')
    ? `<section class="dashboard-grid"><article class="card"><div class="card-head"><div><div class="card-title">Upcoming schedule</div><div class="card-subtitle">Confirmed allocations</div></div><button type="button" class="text-button" data-view="events">Open calendar</button></div><div class="event-list">${events}</div></article><article class="card"><div class="card-head"><div><div class="card-title">Student request queue</div><div class="card-subtitle">Approve and allocate venues</div></div><button type="button" class="text-button" data-view="requests">Open queue</button></div>${queueItems}</article></section>`
    : `<section class="dashboard-grid"><article class="card"><div class="card-head"><div><div class="card-title">Upcoming schedule</div><div class="card-subtitle">Your next confirmed campus activity</div></div><button type="button" class="text-button" data-view="events">View schedule</button></div><div class="event-list">${events}</div></article><article class="card"><div class="card-head"><div><div class="card-title">My requests</div><div class="card-subtitle">Waiting for college approval</div></div><button type="button" class="text-button" data-view="requests">Open requests</button></div>${queueItems}</article></section>`;
  return shellTemplate(`${header(defaultTitle, can('admin') ? 'Resource command centre' : roleLabels[state.user.role], requestAction)}
    <section class="metric-grid">${managerMetrics}</section>${dashboardContent}`);
}

function renderColleges() {
  const cards = state.colleges.map((college) => `<article class="college-card" data-college-card>
    <div class="college-card-top"><span class="college-monogram">${escapeHtml(college.code.slice(0, 2))}</span>${tag('college')}</div>
    <h2>${escapeHtml(college.name)}</h2><p>${escapeHtml(college.city || 'City not added')}</p>
    <div class="college-stats"><span><strong>${college.event_count}</strong> booked events</span><span><strong>${college.resource_count}</strong> venues</span></div>
    <div class="college-contact"><span>College account</span><strong>${escapeHtml(college.dean_name || 'To be assigned')}</strong><small>${escapeHtml(college.dean_email || 'No email added yet')}</small></div>
    <button type="button" class="btn btn-secondary college-open" data-college-open="${college.id}">Open booking calendar</button>
  </article>`).join('');
  return shellTemplate(`${header('Colleges', 'Platform administration', '<button type="button" class="btn btn-primary" data-modal="college">+ Add college</button>')}
    <section class="college-intro"><div><div class="card-title">College workspaces</div><p>Each workspace has its own venues, booking calendar and college account.</p></div><input class="search" data-college-filter placeholder="Search colleges" /></section>
    <section class="college-grid">${cards || '<div class="empty">No colleges have been added.</div>'}</section>`);
}

function renderEvents() {
  const target = state.selectedCollegeId ? state.colleges.find((college) => Number(college.id) === Number(state.selectedCollegeId)) : null;
  const heading = target ? `${target.name} calendar` : 'College booking calendar';
  const managerControls = isAllocator();
  const month = startOfMonth(state.calendarCursor);
  const calendarStart = new Date(month); calendarStart.setDate(1 - month.getDay());
  const dates = Array.from({ length: 42 }, (_, index) => new Date(calendarStart.getFullYear(), calendarStart.getMonth(), calendarStart.getDate() + index));
  const selected = state.selectedCalendarDate || dateKey(state.events[0]?.start_at || new Date());
  const detailEvents = calendarEventsFor(selected);
  const calendarDays = dates.map((date) => {
    const events = calendarEventsFor(date); const currentMonth = date.getMonth() === month.getMonth(); const selectedClass = dateKey(date) === selected ? ' selected' : '';
    return `<button type="button" class="calendar-day ${currentMonth ? '' : 'outside'}${selectedClass}" data-calendar-date="${dateKey(date)}"><time datetime="${dateKey(date)}">${date.getDate()}</time><div class="day-events">${events.slice(0, 2).map((event) => `<span class="calendar-event ${escapeHtml(event.event_type)}">${escapeHtml(event.title)}</span>`).join('')}${events.length > 2 ? `<span class="more-events">+${events.length - 2} more</span>` : ''}</div></button>`;
  }).join('');
  const details = detailEvents.length ? `<div class="booking-detail-list">${detailEvents.map((event) => {
    const venue = venueForEvent(event);
    const venueName = event.resource_name || 'Venue not assigned';
    const venueLink = isLocationViewer() && venue
      ? `<button type="button" class="venue-link" data-directions="${event.id}">${escapeHtml(venueName)}</button>`
      : escapeHtml(venueName);
    const directions = isLocationViewer() && venue
      ? `<button type="button" class="btn btn-secondary btn-small" data-directions="${event.id}">Open venue map & directions</button>`
      : '';
    return `<article class="booking-detail"><div class="booking-detail-head"><div>${tag(event.event_type)}${tag(event.status)}</div>${managerControls ? `<div class="action-row"><button type="button" class="text-button" data-reschedule="${event.id}">Move</button><button type="button" class="text-button danger" data-cancel-event="${event.id}">Cancel</button></div>` : ''}</div><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.description || 'No description provided.')}</p><dl><div><dt>Time</dt><dd>${formatDateTime(event.start_at)} - ${formatDateTime(event.end_at)}</dd></div><div><dt>Venue</dt><dd>${venueLink}</dd></div><div><dt>Priority</dt><dd>${titleCase(event.priority)}</dd></div><div><dt>Location</dt><dd>${escapeHtml(event.resource_building || 'Location not added')}${venue?.location_note ? `<br><span class="location-note">${escapeHtml(venue.location_note)}</span>` : ''}</dd></div></dl>${directions}</article>`;
  }).join('')}</div>` : '<div class="empty calendar-empty">Select a booked date to see its time, location and venue.</div>';
  const planner = managerControls ? `<aside class="calendar-side"><div class="eyebrow">Plan a booking</div><h2>Allocate a campus space</h2><p>Allocate directly to any club or group. Higher priority can replace a lower-priority booking on the same venue.</p><button type="button" class="btn btn-primary btn-full" data-modal="event">Add event</button><div class="quick-events"><span>Quick event names</span><button type="button" data-quick-event="Festember 2026">Festember</button><button type="button" data-quick-event="Pragyan 2026">Pragyan</button><button type="button" data-quick-event="NITTFest">NITTFest</button><button type="button" data-quick-event="Club event">Club event</button></div><button type="button" class="text-button resource-link" data-view="resources">Manage venues</button></aside>` : '';
  return shellTemplate(`${header(heading, managerControls ? 'College booking control' : 'College booking calendar', managerControls ? '<button type="button" class="btn btn-primary" data-modal="event">+ Add & allocate event</button>' : '')}
    <section class="calendar-toolbar">${can('admin') ? `<select class="college-select" id="college-picker">${state.colleges.map((college) => `<option value="${college.id}" ${Number(state.selectedCollegeId) === Number(college.id) ? 'selected' : ''}>${escapeHtml(college.name)}</option>`).join('')}</select>` : `<div class="card-subtitle">${escapeHtml(state.user.college_name || 'Your college')}</div>`}<div class="calendar-legend"><span><i class="legend-dot college"></i>College</span><span><i class="legend-dot club"></i>Club</span><span><i class="legend-dot exam"></i>Exam</span></div></section>
    <section class="calendar-layout ${managerControls ? '' : 'calendar-layout-readonly'}">${planner}
      <article class="card calendar-card"><div class="calendar-head"><button type="button" class="calendar-arrow" data-calendar-move="-1" aria-label="Previous month">←</button><h2>${displayMonth(month)}</h2><button type="button" class="calendar-arrow" data-calendar-move="1" aria-label="Next month">→</button></div><div class="calendar-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="calendar-grid">${calendarDays}</div></article>
      <aside class="calendar-details"><div class="calendar-detail-title"><div><div class="eyebrow">Bookings for</div><h2>${formatDate(`${selected}T12:00:00`, { day: 'numeric', month: 'long', year: 'numeric' })}</h2></div><span>${detailEvents.length}</span></div>${details}</aside></section>`);
}

function requestControls(request) {
  if (!isAllocator() || request.status !== 'pending') return '';
  return `<button type="button" class="text-button" data-review-request="${request.id}">Review</button>`;
}

function renderRequests() {
  const rows = state.requests.map((request) => `<tr><td><div class="primary-cell">${escapeHtml(request.title)}</div><div class="secondary-cell">${escapeHtml(request.requester_name || '')}${request.department ? ` · ${escapeHtml(request.department)}` : ''} · ${titleCase(request.allocation_mode || 'manual')}</div></td><td>${tag(request.request_scope)}</td><td><div>${formatDateTime(request.requested_start)}</div><div class="secondary-cell">${titleCase(request.resource_type)} · ${request.expected_attendance || '—'} people</div></td><td>${escapeHtml(request.assigned_resource_name || (request.allocation_mode === 'automatic' ? 'No auto match' : 'Pending allocation'))}</td><td>${tag(request.status)}${request.review_note ? `<div class="secondary-cell">${escapeHtml(request.review_note)}</div>` : ''}</td><td>${requestControls(request)}</td></tr>`).join('');
  const subtitle = isRequester() ? 'College and admin can see your requests. Allocation happens after college approval.' : 'Student and organizer requests for your college.';
  return shellTemplate(`${header(isRequester() ? 'My booking requests' : 'Booking request queue', subtitle, isRequester() ? '<button type="button" class="btn btn-primary" data-modal="request">New request</button>' : '')}
    <section class="toolbar"><input class="search" data-search="request-table" placeholder="Search requests" /><div class="card-subtitle">${state.requests.filter((request) => request.status === 'pending').length} request(s) awaiting action</div></section>
    <section class="card table-card"><table id="request-table"><thead><tr><th>Request</th><th>Scope</th><th>Requested window</th><th>Resource</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No booking requests found.</td></tr>'}</tbody></table></section>`);
}

function resourceSymbol(type) { return { auditorium: '◒', hall: '▤', classroom: '▥', lab: '⌘', ground: '◯' }[type] || '□'; }
function renderResources() {
  const picker = can('admin') ? `<select class="search" id="resource-college-picker">${state.colleges.map((college) => `<option value="${college.id}" ${Number(state.selectedCollegeId) === Number(college.id) ? 'selected' : ''}>${escapeHtml(college.name)}</option>`).join('')}</select>` : '<div class="card-subtitle">Spaces ready for booking in your college.</div>';
  const cards = state.resources.map((resource) => `<article class="resource-card"><div class="resource-card-top"><div class="resource-icon">${resourceSymbol(resource.resource_type)}</div>${resource.restricted_to_festivals ? '<span class="restricted-badge">Festival only</span>' : (hasCoordinates(resource) ? '<span class="mapped-badge">Mapped</span>' : '')}</div><div class="resource-name">${escapeHtml(resource.name)}</div><div class="resource-meta">${titleCase(resource.resource_type)} · ${resource.capacity} capacity</div><div class="resource-meta">${escapeHtml(resource.building || 'Campus building')}</div><div class="resource-features"><span class="${resource.has_ac ? 'available' : ''}">AC</span><span class="${resource.has_projector ? 'available' : ''}">Projector</span><span class="${Number(resource.computer_count) ? 'available' : ''}">${Number(resource.computer_count) ? `${resource.computer_count} computers` : 'No computers'}</span></div><div class="availability">● Available for allocation</div>${isAllocator() ? `<button type="button" class="text-button resource-pin-action" data-venue-pin="${resource.id}">${hasCoordinates(resource) ? 'Update map pin' : 'Set map pin'}</button>` : ''}</article>`).join('');
  return shellTemplate(`${header('Resources', isAllocator() ? 'Venue inventory' : 'Campus venues', isAllocator() ? '<button type="button" class="btn btn-primary" data-modal="resource">+ Add venue</button>' : '')}<section class="toolbar">${picker}<input class="search" data-resource-filter placeholder="Search resources" /></section><section class="resource-grid">${cards || '<div class="empty">No active resources in this college.</div>'}</section>`);
}

function renderCampusMap() {
  const mapped = state.resources.filter(hasCoordinates);
  const routeVenue = state.resources.find((resource) => Number(resource.id) === Number(state.mapRoute?.venueId));
  const managerHelp = isAllocator()
    ? '<p>Click any venue marker to inspect it. Use “Set map pin” for venues that Google has not named.</p>'
    : '<p>Tap a venue to show a route from your current location. If you do not allow location access, the route starts at NITT Main Gate.</p>';
  const mapActions = isLocationViewer() ? '<button type="button" class="btn btn-secondary" data-locate-me>Show my current location</button>' : '';
  const routePanel = routeVenue ? `<section class="route-panel"><div class="eyebrow">Road route</div><h3>${escapeHtml(routeVenue.name)}</h3>${hasCoordinates(routeVenue) ? `<p>${state.mapRoute?.origin ? `Starting at ${escapeHtml(state.mapRoute.origin.label)}.` : 'Waiting for current-location permission…'}</p>${state.mapRoute?.origin ? '<p class="route-note">The blue route follows mapped roads and paths. Google Maps remains available for turn-by-turn walking guidance.</p><button type="button" class="btn btn-secondary btn-small" data-open-external-route>Open turn-by-turn directions</button>' : ''}` : '<p>This venue needs an exact map pin from the college administrator before directions can be drawn.</p>'}</section>` : '';
  const venueList = state.resources.map((resource) => {
    const action = isAllocator()
      ? `<button type="button" class="text-button" data-venue-pin="${resource.id}">${hasCoordinates(resource) ? 'Edit pin' : 'Pin it'}</button>`
      : (isLocationViewer() && hasCoordinates(resource) ? `<button type="button" class="text-button" data-venue-route="${resource.id}">Directions</button>` : '');
    return `<li><span class="map-venue-dot ${hasCoordinates(resource) ? 'mapped' : ''}"></span><span>${escapeHtml(resource.name)}</span>${action}</li>`;
  }).join('');
  return shellTemplate(`${header('Campus map', isAllocator() ? 'Venue pin management' : 'Venue directions', mapActions)}
    <section class="map-layout"><article class="card map-card"><div class="campus-map" id="campus-map" aria-label="Campus venue map"></div><div class="map-attribution">Map data © OpenStreetMap contributors. Venue pins are maintained by your college.</div></article><aside class="card map-sidebar"><div class="card-head"><div><div class="card-title">${mapped.length} of ${state.resources.length} venues pinned</div><div class="card-subtitle">${isAllocator() ? 'Pin each venue at its actual entrance.' : 'Select a venue for directions.'}</div></div></div><div class="map-sidebar-content">${routePanel}${managerHelp}<ul class="map-venue-list">${venueList || '<li>No venues have been added.</li>'}</ul></div></aside></section>`);
}

function page() {
  if (!state.user) return loginTemplate();
  return ({ overview: renderOverview, colleges: renderColleges, events: renderEvents, requests: renderRequests, resources: renderResources, map: renderCampusMap }[state.view] || renderOverview)();
}
function render() {
  const oldMapState = activeCampusMap;

  activeCampusMap = null;

  if (oldMapState?.map) {
    try {
      oldMapState.map.stop();
      oldMapState.map.remove();
    } catch (error) {
      console.warn(
        'Leaflet map cleanup:',
        error
      );
    }
  }

  app.innerHTML = page();

  queueMicrotask(() => {
    initializeMaps();
  });
}
async function loadWorkspace() {
  const [dashboard, colleges] = await Promise.all([api('/dashboard'), api('/colleges')]);
  state.dashboard = dashboard;
  state.colleges = colleges;
  if (!state.selectedCollegeId) state.selectedCollegeId = state.user.college_id || colleges[0]?.id;
  await loadViewData();
}

async function loadViewData() {
  const collegeId = state.selectedCollegeId || state.user.college_id;
  const tasks = [api('/requests').then((data) => { state.requests = data; })];
  if (collegeId) {
    tasks.push(
      api(`/events?collegeId=${collegeId}`).then((data) => { state.events = data; }),
      api(`/resources?collegeId=${collegeId}`).then((data) => { state.resources = data; })
    );
  }
  await Promise.all(tasks);
}

function modal(title, body) {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-layer" id="modal-layer"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${title}</h2><button type="button" class="icon-close" data-close-modal aria-label="Close">×</button></div><div class="modal-body">${body}</div></div></div>`);
}
function closeModal() { document.querySelector('#modal-layer')?.remove(); }
function selectOptions(values, selected = '') { return values.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join(''); }
function resourceOptions(type = '') { return `<option value="">Assign later</option>${state.resources.filter((resource) => !type || resource.resource_type === type).map((resource) => `<option value="${resource.id}">${escapeHtml(resource.name)} (${resource.capacity})</option>`).join('')}`; }

async function openGuestRegisterModal() {
  modal('Create a guest event pass', '<div class="empty">Loading colleges…</div>');
  try {
    const colleges = await api('/guest/colleges');
    const body = document.querySelector('#modal-layer .modal-body');
    if (!body) return;
    body.innerHTML = `<form id="guest-register-form"><p class="form-note">Guest passes show all active events and venue directions for the selected college. You cannot make bookings or access staff information.</p><div id="guest-register-feedback" class="form-feedback" role="status" aria-live="polite"></div><div class="form-grid"><div class="field span-2"><label>Your name</label><input name="name" autocomplete="name" required /></div><div class="field span-2"><label>Email address</label><input name="email" type="email" autocomplete="email" required /></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="new-password" minlength="8" required /></div><div class="field"><label>College you are visiting</label><select name="collegeId" required>${colleges.map((college) => `<option value="${college.id}">${escapeHtml(college.name)}${college.city ? ` · ${escapeHtml(college.city)}` : ''}</option>`).join('')}</select></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" type="submit">Create guest pass</button></div></form>`;
    document.querySelector('#guest-register-form')?.addEventListener('submit', submitGuestRegistration);
  } catch (error) {
    closeModal();
    toast(error.message || 'Could not load colleges.', 'error');
  }
}

function mapCenter(resources = state.resources) {
  const firstVenue = resources.find(hasCoordinates);
  return firstVenue ? [Number(firstVenue.latitude), Number(firstVenue.longitude)] : [NITT_MAIN_GATE.latitude, NITT_MAIN_GATE.longitude];
}
function initializeMaps() {
  const mapElement =
    document.querySelector('#campus-map');

  if (!mapElement) return;

  if (!window.L) {
    mapElement.innerHTML =
      '<p class="map-fallback">The map could not load. Check your network connection and try again.</p>';
    return;
  }

  const map =
    window.L.map(
      mapElement,
      {
        scrollWheelZoom: true
      }
    ).setView(
      mapCenter(),
      16
    );

  window.L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,
      attribution:
        '© OpenStreetMap contributors'
    }
  ).addTo(map);

  window.L.circleMarker(
    [
      NITT_MAIN_GATE.latitude,
      NITT_MAIN_GATE.longitude
    ],
    {
      radius: 8,
      color: '#176449',
      weight: 2,
      fillColor: '#2aa878',
      fillOpacity: 0.9
    }
  )
    .addTo(map)
    .bindPopup(
      NITT_MAIN_GATE.label
    );

  const mapped =
    state.resources.filter(hasCoordinates);

  const markers = [];

  mapped.forEach((resource) => {

    const isRouteDestination =
      Number(resource.id) ===
      Number(state.mapRoute?.venueId);

    const marker =
      window.L.circleMarker(
        [
          Number(resource.latitude),
          Number(resource.longitude)
        ],
        {
          radius:
            isRouteDestination ? 11 : 9,
          color:
            isRouteDestination
              ? '#7b2f16'
              : '#9d4d28',
          weight: 2,
          fillColor: '#d96e38',
          fillOpacity: 0.9
        }
      ).addTo(map);

    marker.bindPopup(
      `<strong>${escapeHtml(resource.name)}</strong><br>` +
      `${escapeHtml(resource.building || 'Campus venue')}` +
      (
        resource.location_note
          ? `<br>${escapeHtml(resource.location_note)}`
          : ''
      )
    );

    if (isLocationViewer()) {
      marker.on(
        'click',
        () => startVenueDirections(resource)
      );
    }

    markers.push(marker);
  });

  if (markers.length > 1) {
    map.fitBounds(
      window.L.featureGroup(markers)
        .getBounds()
        .pad(0.18),
      {
        animate: false
      }
    );
  }

  activeCampusMap = {
    map,
    currentMarker: null,
    routeLine: null
  };

  drawMapRoute();
}
function initializeVenuePinMap(resource) {
  const mapElement = document.querySelector('#venue-pin-map');

  if (!mapElement) return;

  if (!window.L) {
    mapElement.innerHTML =
      '<p class="map-fallback">Map unavailable. Enter the latitude and longitude manually.</p>';
    return;
  }

  const initial = hasCoordinates(resource)
    ? [
        Number(resource.latitude),
        Number(resource.longitude)
      ]
    : mapCenter();

  const map = window.L.map(mapElement).setView(
    initial,
    hasCoordinates(resource) ? 18 : 16
  );

  window.L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  ).addTo(map);

  const latitude =
    document.querySelector('#venue-latitude');

  const longitude =
    document.querySelector('#venue-longitude');

  let marker = null;

  const setPin = (latlng) => {
    latitude.value = Number(latlng.lat).toFixed(6);
    longitude.value = Number(latlng.lng).toFixed(6);

    if (marker) {
      marker.setLatLng(latlng);
    } else {
      marker = window.L.marker(latlng, {
        draggable: true
      }).addTo(map);

      marker.on('dragend', () => {
        setPin(marker.getLatLng());
      });
    }
  };

  if (hasCoordinates(resource)) {
    setPin({
      lat: Number(resource.latitude),
      lng: Number(resource.longitude)
    });
  }

  map.on('click', (event) => {
    setPin(event.latlng);
  });
}
function openVenuePinModal(resourceId) {
  const resource = state.resources.find((item) => Number(item.id) === Number(resourceId));
  if (!resource) return;
  modal(`Set map pin · ${escapeHtml(resource.name)}`, `<form id="venue-pin-form"><input type="hidden" name="resourceId" value="${resource.id}" /><p class="form-note">Click the exact entrance or meeting point. The marker name is yours, even when the building is unnamed on Google Maps.</p><div class="venue-pin-map" id="venue-pin-map" aria-label="Choose venue location on map"></div><div class="form-grid"><div class="field"><label>Latitude</label><input id="venue-latitude" name="latitude" type="number" step="0.000001" min="-90" max="90" value="${hasCoordinates(resource) ? escapeHtml(resource.latitude) : ''}" required /></div><div class="field"><label>Longitude</label><input id="venue-longitude" name="longitude" type="number" step="0.000001" min="-180" max="180" value="${hasCoordinates(resource) ? escapeHtml(resource.longitude) : ''}" required /></div><div class="field span-2"><label>Entrance or landmark note</label><input name="locationNote" maxlength="220" value="${escapeHtml(resource.location_note || '')}" placeholder="e.g. Use the east entrance beside the SAC" /></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary">Save map pin</button></div></form>`);
  initializeVenuePinMap(resource);
  document.querySelector('#venue-pin-form')?.addEventListener('submit', submitVenuePin);
}

function openCollegeModal() {
  modal('Add a college workspace', `<form id="college-form"><div class="form-grid"><div class="field span-2"><label>College name</label><input name="name" placeholder="e.g. National Institute of Technology Tiruchirappalli" required /></div><div class="field"><label>Short code</label><input name="code" placeholder="NITT" maxlength="20" required /></div><div class="field"><label>City</label><input name="city" placeholder="e.g. Tiruchirappalli" required /></div><div class="field span-2"><label>College account name</label><input name="deanName" placeholder="Name for the college login" required /></div><div class="field"><label>College account email</label><input name="deanEmail" type="email" placeholder="college@nitt.edu" required /></div><div class="field"><label>Temporary password</label><input name="deanPassword" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters" required /></div></div><p class="form-note">Creates the college and a college-role account that can allocate venues without extra permission.</p><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary">Create college</button></div></form>`);
  document.querySelector('#college-form').addEventListener('submit', submitCollege);
}
function openEventModal(title = '') {
  const prefillDepartment = state.user.department || '';
  const venues = state.resources.length ? `<select name="resourceId" required><option value="">Select a venue to allocate</option>${state.resources.map((resource) => `<option value="${resource.id}">${escapeHtml(resource.name)} (${resource.capacity} capacity)${resource.restricted_to_festivals ? ' — festival only' : ''}</option>`).join('')}</select>` : '<input disabled value="Add a venue before scheduling" />';
  modal('Add and allocate an event', `<form id="event-form"><div class="form-grid"><div class="field span-2"><label>Event title</label><input name="title" value="${escapeHtml(title)}" required placeholder="e.g. Festember 2026" /></div><div class="field"><label>Event scope</label><select name="eventType" required>${selectOptions([['college','College event'],['club','Club event'],['department','Department event'],['exam','Examination']])}</select></div><div class="field"><label>Priority</label><select name="priority">${selectOptions([['normal','Normal'],['low','Low'],['high','High'],['critical','Critical']])}</select></div><div class="field"><label>Start</label><input name="startAt" type="datetime-local" value="${localDateTime(new Date(Date.now() + 86400000))}" required /></div><div class="field"><label>End</label><input name="endAt" type="datetime-local" value="${localDateTime(new Date(Date.now() + 90000000))}" required /></div><div class="field"><label>Venue allocation</label>${venues}</div><div class="field"><label>Department (if applicable)</label><input name="department" value="${escapeHtml(prefillDepartment)}" placeholder="Department name" /></div><div class="field span-2"><label>Brief description</label><textarea name="description" placeholder="What is the event about?"></textarea></div></div><p class="form-note">College can allocate directly. If the venue is already booked, a higher priority request can replace the lower-priority booking. Guests can see every active event.</p><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary" ${state.resources.length ? '' : 'disabled'}>Schedule and allocate</button></div></form>`);
  document.querySelector('#event-form').addEventListener('submit', submitEvent);
}
function openResourceModal() {
  modal('Add a venue', `<form id="resource-form"><div class="form-grid"><div class="field span-2"><label>Venue name</label><input name="name" placeholder="e.g. Main Auditorium" required /></div><div class="field"><label>Venue type</label><select name="resourceType">${selectOptions([['auditorium','Auditorium'],['hall','Hall'],['classroom','Classroom'],['lab','Lab'],['ground','Ground']])}</select></div><div class="field"><label>Capacity</label><input name="capacity" type="number" min="1" placeholder="e.g. 250" required /></div><div class="field span-2"><label>Building / location</label><input name="building" placeholder="e.g. Student Activity Centre" required /></div><div class="field"><label>Computers available</label><input name="computerCount" type="number" min="0" value="0" required /></div><div class="feature-toggles span-2"><label><input name="hasAc" type="checkbox" /> Air conditioned</label><label><input name="hasProjector" type="checkbox" /> Projector available</label><label><input name="restrictedToFestivals" type="checkbox" /> Reserve for Festember, NITTFest and Pragyan only</label></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary">Add venue</button></div></form>`);
  document.querySelector('#resource-form').addEventListener('submit', submitResource);
}
function openRequestModal() {
  const permitted = [['club', 'Club event'], ['college', 'Normal event / company seminar']];
  const requirement = (label, name) => `<div class="requirement-question"><span>${label}</span><label><input type="radio" name="${name}" value="true" /> Yes</label><label><input type="radio" name="${name}" value="false" checked /> No</label></div>`;
  modal('Request a resource', `<form id="request-form">
    <div class="allocation-choice span-2"><span>How should we allocate the venue?</span>
      <label><input type="radio" name="allocationMode" value="manual" checked /> Manual</label>
      <label><input type="radio" name="allocationMode" value="automatic" /> Automatic</label>
    </div>
    <div class="manual-requirements"><div class="requirements-title">Manual allocation</div><p>College will review your request and choose the venue. No facility radios are needed here.</p></div>
    <div class="form-grid">
      <div class="field span-2"><label>Event title</label><input name="title" required placeholder="e.g. Company seminar with Design Club" /></div>
      <div class="field"><label>Request type</label><select name="requestScope">${selectOptions(permitted)}</select></div>
      <div class="field"><label>Space needed</label><select name="resourceType">${selectOptions([['hall','Hall'],['classroom','Classroom'],['lab','Lab'],['auditorium','Auditorium']])}</select></div>
      <div class="field"><label>Start</label><input name="requestedStart" type="datetime-local" value="${localDateTime(new Date(Date.now() + 172800000))}" required /></div>
      <div class="field"><label>End</label><input name="requestedEnd" type="datetime-local" value="${localDateTime(new Date(Date.now() + 176400000))}" required /></div>
      <div class="field"><label>Capacity needed</label><input name="expectedAttendance" type="number" min="1" placeholder="e.g. 105" required /></div>
      <div class="field"><label>Priority</label><select name="priority">${selectOptions([['normal','Normal'],['low','Low'],['high','High'],['critical','Critical']])}</select></div>
      <div class="automatic-requirements span-2" hidden>
        <div class="requirements-title">Automatic allocation requirements</div>
        <p>The system suggests a free venue from your requirements. College still must approve. Capacity may be within 5% (example: request 105, allot a 100-seat hall).</p>
        <div class="requirement-grid">${requirement('AC needed?', 'needsAc')}${requirement('Projector needed?', 'needsProjector')}${requirement('Computers needed?', 'needsComputers')}</div>
      </div>
      <div class="field span-2"><label>Purpose</label><textarea name="description" placeholder="Club event details or company seminar context."></textarea></div>
    </div>
    <div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary">Submit for college approval</button></div>
  </form>`);
  document.querySelector('#request-form').addEventListener('submit', submitRequest);
  const syncMode = () => {
    const mode = document.querySelector('input[name="allocationMode"]:checked')?.value;
    document.querySelector('.automatic-requirements').hidden = mode !== 'automatic';
    document.querySelector('.manual-requirements').hidden = mode !== 'manual';
  };
  document.querySelectorAll('input[name="allocationMode"]').forEach((input) => input.addEventListener('change', syncMode));
  syncMode();
}
function openReviewModal(requestId) {
  const request = state.requests.find((item) => Number(item.id) === Number(requestId));
  if (!request) return;
  const festivalTitle = /festember|nittfest|pragyan/i.test(request.title || '');
  const matchingResources = state.resources.filter((resource) => resource.resource_type === request.resource_type && (!resource.restricted_to_festivals || festivalTitle));
  const selectedId = request.assigned_resource_id || '';
  modal('Review booking request', `<form id="review-form"><div class="review-request"><h3>${escapeHtml(request.title)}</h3><p>${escapeHtml(request.requester_name)} requested a ${escapeHtml(request.resource_type)} for ${formatDateTime(request.requested_start)}. Mode: ${titleCase(request.allocation_mode)}. Expected attendance: ${request.expected_attendance || 'not specified'}.</p>${request.allocation_mode === 'automatic' ? `<p>Automatic suggestion: ${escapeHtml(request.assigned_resource_name || 'none found')}.</p>` : ''}</div><input type="hidden" name="requestId" value="${request.id}" /><div class="field"><label>Decision</label><select name="status"><option value="approved">Approve and allocate</option><option value="changes_requested">Request changes</option><option value="declined">Decline request</option></select></div><div class="field"><label>Assigned ${titleCase(request.resource_type)}</label><select name="resourceId"><option value="">Select a venue</option>${matchingResources.map((resource) => `<option value="${resource.id}" ${Number(resource.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(resource.name)} · ${resource.capacity} seats</option>`).join('')}</select></div><div class="field"><label>Note to requester</label><textarea name="note" placeholder="Optional message or reason"></textarea></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary">Save decision</button></div></form>`);
  document.querySelector('#review-form').addEventListener('submit', submitReview);
}
function openRescheduleModal(eventId) {
  const event = state.events.find((item) => Number(item.id) === Number(eventId));
  if (!event) return;
  modal('Move event', `<form id="reschedule-form"><div class="review-request"><h3>${escapeHtml(event.title)}</h3><p>College can move bookings. Higher priority can take over a lower-priority venue slot.</p></div><input type="hidden" name="eventId" value="${event.id}" /><div class="form-grid"><div class="field"><label>New start</label><input name="startAt" type="datetime-local" value="${localDateTime(new Date(event.start_at))}" required /></div><div class="field"><label>New end</label><input name="endAt" type="datetime-local" value="${localDateTime(new Date(event.end_at))}" required /></div><div class="field"><label>Priority</label><select name="priority">${selectOptions([['normal','Normal'],['low','Low'],['high','High'],['critical','Critical']], event.priority)}</select></div><div class="field span-2"><label>Venue</label><select name="resourceId">${resourceOptions().replace(`value="${event.resource_id}"`, `value="${event.resource_id}" selected`)}</select></div></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancel</button><button class="btn btn-primary">Update schedule</button></div></form>`);
  document.querySelector('#reschedule-form').addEventListener('submit', submitReschedule);
}

async function afterMutation(message) { closeModal(); await loadWorkspace(); render(); toast(message); }
async function submitCollege(event) { event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget)); try { await api('/colleges', { method: 'POST', body: JSON.stringify(form) }); await afterMutation('College added.'); } catch (error) { toast(error.message, 'error'); } }
async function submitEvent(event) {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const form = Object.fromEntries(formData);

  form.collegeId = state.selectedCollegeId;
  form.guestVisible = formData.get('guestVisible') === 'on';

  // TIMEZONE FIX: datetime-local has no timezone, so convert the user's
  // local date/time to an ISO UTC timestamp before sending it.
  form.startAt = localDateTimeToISO(form.startAt);
  form.endAt = localDateTimeToISO(form.endAt);

  try {
    const created = await api('/events', {
      method: 'POST',
      body: JSON.stringify(form)
    });

    const note = created.displaced?.length
      ? ` Allocated by replacing ${created.displaced.map((item) => item.title).join(', ')}.`
      : '';

    await afterMutation(`Event scheduled.${note}`);
  } catch (error) {
    toast(error.message, 'error');
  }
}
async function submitResource(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const form = Object.fromEntries(formData);
  form.collegeId = state.selectedCollegeId;
  form.hasAc = formData.get('hasAc') === 'on';
  form.hasProjector = formData.get('hasProjector') === 'on';
  form.restrictedToFestivals = formData.get('restrictedToFestivals') === 'on';
  try { await api('/resources', { method: 'POST', body: JSON.stringify(form) }); await afterMutation('Venue added and ready for allocation.'); } catch (error) { toast(error.message, 'error'); }
}
async function submitVenuePin(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await api(`/resources/${form.resourceId}/location`, { method: 'PATCH', body: JSON.stringify(form) });
    await afterMutation('Venue map pin saved. Guests and students can now use it for directions.');
  } catch (error) { toast(error.message, 'error'); }
}
async function submitGuestRegistration(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const feedback = event.currentTarget.querySelector('#guest-register-feedback');
  submitButton.disabled = true; submitButton.textContent = 'Creating pass…';
  feedback.textContent = '';
  feedback.className = 'form-feedback';
  try {
    const session = await api('/auth/guest-register', { method: 'POST', body: JSON.stringify(form) });
    state.token = session.token; state.user = session.user; state.selectedCollegeId = session.user.college_id;
    state.guestJustCreated = true;
    localStorage.setItem('campus_token', session.token);
    closeModal();
    await loadWorkspace();
    render();
    toast('Guest account created successfully. Your event pass is ready.', 'success');
  } catch (error) {
    feedback.textContent = error.message;
    feedback.className = 'form-feedback error';
    toast(error.message, 'error');
    submitButton.disabled = false; submitButton.textContent = 'Create guest pass';
  }
}
async function submitRequest(event) {
  event.preventDefault();

  const form = Object.fromEntries(new FormData(event.currentTarget));

  form.needsAc = form.needsAc === 'true';
  form.needsProjector = form.needsProjector === 'true';
  form.needsComputers = form.needsComputers === 'true';
  form.expectedAttendance = Number(form.expectedAttendance);

  // TIMEZONE FIX: convert local datetime-local values to UTC.
  form.requestedStart = localDateTimeToISO(form.requestedStart);
  form.requestedEnd = localDateTimeToISO(form.requestedEnd);

  try {
    const created = await api('/requests', {
      method: 'POST',
      body: JSON.stringify(form)
    });

    const message = form.allocationMode === 'automatic'
      ? (created.automaticSuggestion
          ? `Request sent with automatic suggestion: ${created.assigned_resource_name}. Waiting for college approval.`
          : 'No automatic match. Request sent for college manual allocation.')
      : 'Manual request submitted for college approval.';

    await afterMutation(message);
  } catch (error) {
    toast(error.message, 'error');
  }
}
async function submitReview(event) { event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget)); try { await api(`/requests/${form.requestId}`, { method: 'PATCH', body: JSON.stringify(form) }); await afterMutation('Request decision saved.'); } catch (error) { toast(error.message, 'error'); } }
async function submitReschedule(event) {
  event.preventDefault();

  const form = Object.fromEntries(new FormData(event.currentTarget));

  // TIMEZONE FIX: convert local datetime-local values to UTC.
  form.startAt = localDateTimeToISO(form.startAt);
  form.endAt = localDateTimeToISO(form.endAt);

  try {
    await api(`/events/${form.eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(form)
    });

    await afterMutation('Event has been rescheduled.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function haversineKm(first, second) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(Number(second.latitude) - Number(first.latitude));
  const longitudeDelta = toRadians(Number(second.longitude) - Number(first.longitude));
  const sinLat = Math.sin(latitudeDelta / 2);
  const sinLng = Math.sin(longitudeDelta / 2);
  const a = sinLat * sinLat + Math.cos(toRadians(Number(first.latitude))) * Math.cos(toRadians(Number(second.latitude))) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function isGateOrigin(origin) {
  if (!origin) return false;
  const gateDistanceKm = haversineKm(origin, NITT_MAIN_GATE);
  return gateDistanceKm < 0.8 || origin.label === 'NITT Main Gate';
}

function directRoutePoints(originPoint, destinationPoint) {
  const [originLat, originLng] = originPoint;
  const [destinationLat, destinationLng] = destinationPoint;
  const midLat = originLat + (destinationLat - originLat) * 0.5;
  const midLng = originLng + (destinationLng - originLng) * 0.5;
  return [originPoint, [midLat, midLng], destinationPoint];
}

async function getWalkingRoutePoints(origin, destination) {
  const response = await api('/directions', {
    method: 'POST',
    body: JSON.stringify({
      origin: {
        latitude: Number(origin.latitude),
        longitude: Number(origin.longitude)
      },
      destination: {
        latitude: Number(destination.latitude),
        longitude: Number(destination.longitude)
      }
    })
  });

  if (
    !response ||
    !Array.isArray(response.coordinates) ||
    response.coordinates.length < 2
  ) {
    throw new Error('No usable walking route was returned.');
  }

  return response.coordinates;
}
async function updateRouteMarkerAndPath(venue, origin) {
  if (!activeCampusMap || !activeCampusMap.map) {
    return;
  }

  const mapState = activeCampusMap;
  const mapInstance = mapState.map;

  const originPoint = [
    Number(origin.latitude),
    Number(origin.longitude)
  ];

  try {
    const routePoints = await getWalkingRoutePoints(
      origin,
      venue
    );

    /*
     * IMPORTANT:
     * The user may have navigated away while the
     * routing request was running.
     *
     * Never touch a map that is no longer active.
     */
    if (
      activeCampusMap !== mapState ||
      activeCampusMap.map !== mapInstance
    ) {
      return;
    }

    const container = mapInstance.getContainer();

    if (!container || !container.isConnected) {
      return;
    }

    if (mapState.currentMarker) {
      mapState.currentMarker.setLatLng(originPoint);
    } else {
      mapState.currentMarker =
        window.L.circleMarker(
          originPoint,
          {
            radius: 9,
            color: '#1e5f99',
            weight: 3,
            fillColor: '#59a8e8',
            fillOpacity: 1
          }
        )
        .addTo(mapInstance)
        .bindPopup(
          escapeHtml(origin.label)
        );
    }

    if (mapState.routeLine) {
      mapState.routeLine.remove();
      mapState.routeLine = null;
    }

    mapState.routeLine =
      window.L.polyline(
        routePoints,
        {
          color: '#1e5f99',
          weight: 5,
          opacity: 0.9
        }
      ).addTo(mapInstance);

    /*
     * Do NOT animate the zoom.
     * This prevents Leaflet's _leaflet_pos
     * error when the application rerenders.
     */
    mapInstance.fitBounds(
      window.L.latLngBounds(routePoints).pad(0.18),
      {
        animate: false
      }
    );

  } catch (error) {

    if (
      activeCampusMap === mapState &&
      activeCampusMap.map === mapInstance
    ) {
      if (mapState.routeLine) {
        mapState.routeLine.remove();
        mapState.routeLine = null;
      }

      toast(
        error.message ||
        'Could not calculate walking route.',
        'error'
      );
    }
  }
}
function pickGuestRouteOrigin(venue, callback) {
  if (!navigator.geolocation) {
    callback(NITT_MAIN_GATE);
    return;
  }

  if (
    state.routeWatchId !== null &&
    navigator.geolocation.clearWatch
  ) {
    navigator.geolocation.clearWatch(state.routeWatchId);
    state.routeWatchId = null;
  }

  const handlePosition = (position) => {
    const current = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      label: 'Your current location'
    };

    const distanceFromGateKm =
      haversineKm(current, NITT_MAIN_GATE);

    const chosenOrigin =
      distanceFromGateKm > 8
        ? NITT_MAIN_GATE
        : current;

    if (
      activeCampusMap &&
      state.mapRoute &&
      Number(state.mapRoute.venueId) === Number(venue.id)
    ) {
      state.mapRoute.origin = chosenOrigin;
      updateRouteMarkerAndPath(
        venue,
        chosenOrigin
      );
      return;
    }

    callback(chosenOrigin);
  };

  navigator.geolocation.getCurrentPosition(
    handlePosition,
    () => {
      callback(NITT_MAIN_GATE);
      toast(
        'Location permission was not granted. Using NITT Main Gate for directions.',
        'error'
      );
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    }
  );
}
function directionUrl(venue, origin = null) {
  const destination = `${Number(venue.latitude)},${Number(venue.longitude)}`;
  const params = new URLSearchParams({ api: '1', destination, travelmode: 'walking' });
  if (origin) params.set('origin', `${origin.latitude},${origin.longitude}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
async function drawMapRoute() {
  const route = state.mapRoute;

  const venue = state.resources.find(
    resource =>
      Number(resource.id) === Number(route?.venueId)
  );

  if (
    !route?.origin ||
    !venue ||
    !hasCoordinates(venue) ||
    !activeCampusMap ||
    !activeCampusMap.map ||
    !window.L
  ) {
    return;
  }

  await updateRouteMarkerAndPath(
    venue,
    route.origin
  );
}

function applyRouteOrigin(venue, origin) {
  if (state.routeWatchId !== null && navigator.geolocation && navigator.geolocation.clearWatch) {
    navigator.geolocation.clearWatch(state.routeWatchId);
  }
  state.routeWatchId = null;
  state.mapRoute = { venueId: venue.id, origin };
  state.view = 'map';
  render();
}

function startVenueDirections(venue) {
  if (!isLocationViewer()) return toast('Directions are available only to students and registered guests.', 'error');
  if (!venue) return toast('This event does not have a venue yet.', 'error');
  if (!hasCoordinates(venue)) {
    state.mapRoute = { venueId: venue.id, origin: null };
    state.view = 'map';
    render();
    toast('The venue map opened, but the college administrator must set this venue’s exact pin before directions can be drawn.', 'error');
    return;
  }
  state.mapRoute = { venueId: venue.id, origin: null };
  state.view = 'map';
  render();

  if (!navigator.geolocation) {
    applyRouteOrigin(venue, NITT_MAIN_GATE);
    toast('Current location is unavailable, so directions start from NITT Main Gate.');
    return;
  }

  toast('Checking your location for a better walking route…');
  pickGuestRouteOrigin(venue, (origin) => applyRouteOrigin(venue, origin));
}

function startDirections(eventId) {
  const event = state.events.find((item) => Number(item.id) === Number(eventId));
  startVenueDirections(venueForEvent(event));
}

function startVenueDirectionsById(resourceId) {
  startVenueDirections(state.resources.find((resource) => Number(resource.id) === Number(resourceId)));
}

function openExternalDirections() {
  const venue = state.resources.find((resource) => Number(resource.id) === Number(state.mapRoute?.venueId));
  if (!venue || !state.mapRoute?.origin) return;
  window.open(directionUrl(venue, state.mapRoute.origin), '_blank', 'noopener,noreferrer');
}

function locateMe() {
  if (!isLocationViewer()) return toast('Current location is available only to students and registered guests.', 'error');
  const activeRouteVenue = state.resources.find((resource) => Number(resource.id) === Number(state.mapRoute?.venueId));
  if (activeRouteVenue) return startVenueDirections(activeRouteVenue);
  if (!activeCampusMap || !window.L) return toast('Open the Campus map first.', 'error');
  if (!navigator.geolocation) return toast('Your browser does not support current location.', 'error');
  navigator.geolocation.getCurrentPosition((position) => {
    const point = [position.coords.latitude, position.coords.longitude];
    if (activeCampusMap.currentMarker) activeCampusMap.currentMarker.setLatLng(point);
    else activeCampusMap.currentMarker = window.L.circleMarker(point, { radius: 9, color: '#1e5f99', weight: 3, fillColor: '#59a8e8', fillOpacity: 1 }).addTo(activeCampusMap.map).bindPopup('Your current location');
    activeCampusMap.currentMarker.openPopup();
    activeCampusMap.map.setView(point, 16);
  }, () => toast('Location permission was not granted. You can still view venue pins.', 'error'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
}

function filterTable(input, selector) { const phrase = input.value.toLowerCase(); document.querySelectorAll(`${selector} tbody tr`).forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(phrase); }); }

async function switchView(view) {
  state.view = view;
  try {
    await loadViewData();
  } catch (error) {
    toast(error.message || 'Could not load that page.', 'error');
  }
  render();
}

function bindGlobalEvents() {
  if (state.eventsBound) return;
  state.eventsBound = true;

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-view], [data-logout], [data-modal], [data-guest-login], [data-college-open], [data-calendar-date], [data-calendar-move], [data-quick-event], [data-review-request], [data-reschedule], [data-cancel-event], [data-close-modal], [data-venue-pin], [data-directions], [data-locate-me], [data-venue-route], [data-open-external-route], [data-toggle-guest-event], #local-admin-login');
    if (!target) return;

    if (target.hasAttribute('data-close-modal') || target.id === 'modal-layer') {
      closeModal();
      return;
    }
    if (target.hasAttribute('data-logout')) {
      logout();
      return;
    }
    if (target.id === 'local-admin-login') {
      const form = document.querySelector('#login-form');
      if (!form) return;
      form.elements.email.value = 'Akshaypra22@gmail.com';
      form.elements.password.value = 'Akshay@1155';
      form.requestSubmit();
      return;
    }
    if (target.hasAttribute('data-view')) {
      event.preventDefault();
      await switchView(target.dataset.view);
      return;
    }
    if (target.dataset.modal === 'college') return openCollegeModal();
    if (target.dataset.modal === 'event') return openEventModal();
    if (target.dataset.modal === 'resource') return openResourceModal();
    if (target.dataset.modal === 'request') return openRequestModal();
    if (target.dataset.modal === 'guest-signup') return openGuestRegisterModal();
    if (target.hasAttribute('data-guest-login')) return loginAsGuest();
    if (target.hasAttribute('data-college-open')) {
      state.selectedCollegeId = target.dataset.collegeOpen;
      state.selectedCalendarDate = null;
      state.calendarCursor = new Date();
      await switchView('events');
      return;
    }
    if (target.hasAttribute('data-calendar-date')) {
      state.selectedCalendarDate = target.dataset.calendarDate;
      render();
      return;
    }
    if (target.hasAttribute('data-calendar-move')) {
      state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + Number(target.dataset.calendarMove), 1);
      render();
      return;
    }
    if (target.hasAttribute('data-quick-event')) return openEventModal(target.dataset.quickEvent);
    if (target.hasAttribute('data-review-request')) return openReviewModal(target.dataset.reviewRequest);
    if (target.hasAttribute('data-reschedule')) return openRescheduleModal(target.dataset.reschedule);
    if (target.hasAttribute('data-venue-pin')) return openVenuePinModal(target.dataset.venuePin);
    if (target.hasAttribute('data-directions')) return startDirections(target.dataset.directions);
    if (target.hasAttribute('data-locate-me')) return locateMe();
    if (target.hasAttribute('data-venue-route')) return startVenueDirectionsById(target.dataset.venueRoute);
    if (target.hasAttribute('data-open-external-route')) return openExternalDirections();
    if (target.hasAttribute('data-toggle-guest-event')) {
      const booking = state.events.find((item) => Number(item.id) === Number(target.dataset.toggleGuestEvent));
      if (!booking) return;
      try {
        await api(`/events/${booking.id}`, { method: 'PATCH', body: JSON.stringify({ guestVisible: !booking.guest_visible }) });
        await afterMutation(booking.guest_visible ? 'Event hidden from guests.' : 'Event published to registered guests.');
      } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (target.hasAttribute('data-cancel-event')) {
      if (!confirm('Cancel this event? It will be removed from the active schedule.')) return;
      try { await api(`/events/${target.dataset.cancelEvent}`, { method: 'DELETE' }); await afterMutation('Event cancelled.'); } catch (error) { toast(error.message, 'error'); }
    }
  });

  document.addEventListener('change', async (event) => {
    if (event.target.id === 'college-picker' || event.target.id === 'resource-college-picker') {
      state.selectedCollegeId = event.target.value;
      state.selectedCalendarDate = null;
      if (event.target.id === 'college-picker') state.calendarCursor = new Date();
      try { await loadViewData(); render(); } catch (error) { toast(error.message, 'error'); }
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-search]')) filterTable(event.target, `#${event.target.dataset.search}`);
    if (event.target.matches('[data-resource-filter]')) {
      const phrase = event.target.value.toLowerCase();
      document.querySelectorAll('.resource-card').forEach((card) => { card.hidden = !card.textContent.toLowerCase().includes(phrase); });
    }
    if (event.target.matches('[data-college-filter]')) {
      const phrase = event.target.value.toLowerCase();
      document.querySelectorAll('[data-college-card]').forEach((card) => { card.hidden = !card.textContent.toLowerCase().includes(phrase); });
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.id === 'login-form') login(event);
  });

  document.addEventListener('click', (event) => {
    if (event.target.id === 'modal-layer') closeModal();
  });
}

async function login(event) {
  event.preventDefault();
  
  // This grabs the data from the form that triggered the event (event.target)
  const form = Object.fromEntries(new FormData(event.target)); 
  
  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true; submitButton.textContent = 'Signing in…';
  
  try {
    const session = await api('/auth/login', { method: 'POST', body: JSON.stringify(form) });
    state.token = session.token; state.user = session.user; state.selectedCollegeId = session.user.college_id; state.guestJustCreated = false;
    localStorage.setItem('campus_token', session.token);
    await loadWorkspace(); render(); toast(`Welcome back, ${session.user.name.split(' ')[0]}.`);
  } catch (error) { 
    toast(error.message, 'error'); 
    submitButton.disabled = false; 
    submitButton.textContent = 'Sign in to workspace'; 
  }
}

async function loginAsGuest() {
  try {
    const session = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'guest@nitt.edu', password: 'Welcome@123' }) });
    state.token = session.token; state.user = session.user; state.selectedCollegeId = session.user.college_id; state.guestJustCreated = false;
    localStorage.setItem('campus_token', session.token);
    await loadWorkspace(); render(); toast('Welcome, guest visitor.');
  } catch (error) {
    toast(error.message || 'Guest access is unavailable right now.', 'error');
  }
}

async function init() {
  bindGlobalEvents();
  if (!state.token) return render();
  try {
    state.user = await api('/auth/me');
    state.selectedCollegeId = state.user.college_id; state.guestJustCreated = false;
    await loadWorkspace();
    render();
  } catch {
    localStorage.removeItem('campus_token');
    state.token = null;
    state.user = null;
    render();
  }
}
init();
