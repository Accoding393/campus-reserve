# Campus Reserve

Campus Reserve is a College Resource Management System for coordinating auditoriums, halls, classrooms and labs across colleges.

## What is included

- **Admin** can add colleges, view all college schedules, manage events and oversee every request.
- **Dean / College Resource Manager** manages campus-level events, reviews college requests, and can reschedule or cancel events based on priority.
- **HOD** reviews department and examination requests, then allocates an appropriate classroom, lab, hall or auditorium.
- **Faculty** can create department or examination booking requests/events.
- **Student club head** can submit club-event booking requests; they are routed to the HOD for review.
- PostgreSQL schema and seed data, including resources, upcoming events, and example requests.

## Technology

- Client: responsive HTML, CSS and vanilla JavaScript
- Server: Node.js with Express
- Database: PostgreSQL via `pg`
- Authentication: signed JWT sessions with bcrypt password hashes

## Set up locally

1. Create a PostgreSQL database named `campus_reserve`.

   ```sql
   CREATE DATABASE campus_reserve;
   ```

2. Copy `.env.example` to `.env` and update `DATABASE_URL` with your PostgreSQL username, password, host and database name.

3. Install packages and initialise the database:

   ```bash
   npm install
   npm run db:setup
   ```

   If the database already contains your bookings, use the non-destructive migration instead of resetting data:

   ```bash
   npm run db:migrate
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:4000](http://localhost:4000).

## Initial accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `Akshaypra22@gmail.com` | `Akshay@1155` |
| Dean | `dean@nce.edu` | `Welcome@123` |
| HOD | `hod.cse@nce.edu` | `Welcome@123` |
| Faculty | `faculty.cse@nce.edu` | `Welcome@123` |
| Student club head | `clubhead@nce.edu` | `Welcome@123` |

For production, replace demo passwords and set a strong unique `JWT_SECRET` in `.env`.

## Guest event map

- College administrators can set an exact map pin for each venue.
- Guests see every active event for their selected college. Students and guests can request browser location and see a route preview; if they decline location access, the route starts at NITT Main Gate. Faculty accounts do not receive venue coordinates or the campus-map screen.
- The built-in map uses OpenStreetMap tiles and does not need an API key. It can pin any venue by latitude/longitude even when that building is not named in Google Maps. Directions open in Google Maps.
- For production, serve the site over HTTPS. Browsers require it before they will provide a visitor's current location (except on localhost).

## Project files

```text
client/
  index.html       Application layout entry point
  styles.css       Responsive interface styling
  app.js           Screens, API requests and role-aware interactions
server/
  app.js           Express API and permission rules
  auth.js          JWT authentication middleware
  db.js            PostgreSQL connection
database/
  schema.sql       PostgreSQL table definitions and indexes
  seed.js          Database setup plus initial users and sample data
```
