# KamarUploader

Dedicated Kamar CSV uploader service for Tech Space websites.

## What this service does

- Hosts upload pages for:
  - Staff CSV
  - Student timetable CSV
  - Teacher timetable CSV
- Syncs uploaded data into PostgreSQL tables:
  - `staff_upload`
  - `student_upload`
  - `timetable_upload`
- Exposes API routes that your other Tech Space sites can read from.

## Stack

- Node.js + Express
- PostgreSQL (Render)

## Environment variables

Create a `.env` file locally or set environment variables in Render:

- `DATABASE_URL` (required)
- `PORT` (optional, defaults to `10000`)
- `GOOGLE_CLIENT_ID` (optional, required for Google Login)
- `GOOGLE_ALLOWED_DOMAIN` (optional, defaults to `westlandhigh.school.nz`)
- `AUTH_SESSION_SECRET` (optional but strongly recommended for stable signed sessions)
- `INITIAL_ADMIN_EMAIL` (optional bootstrap admin account for first login)

Example:

```
DATABASE_URL=postgresql://username:password@host:5432/database
PORT=10000
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
GOOGLE_ALLOWED_DOMAIN=westlandhigh.school.nz
AUTH_SESSION_SECRET=replace-with-a-long-random-secret
INITIAL_ADMIN_EMAIL=your.name@westlandhigh.school.nz
```

## Local run

1. Install dependencies:

```
npm install
```

2. Start the server:

```
npm start
```

3. Open:

- `http://localhost:10000/staff_upload.html`
- `http://localhost:10000/` (homepage dashboard + Google sign-in)
- `http://localhost:10000/student_upload.html`
- `http://localhost:10000/timetable_upload.html`

## API routes

- `GET /health`
- `GET /api/auth/google/config`
- `POST /api/auth/google-login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/staff_upload/all`
- `POST /api/staff_upload`
- `GET /api/student_upload/all`
- `POST /api/student_upload`
- `GET /api/timetable/all`
- `POST /api/upload_timetable`
- `PUT /api/upload_timetable/row/:teacherKey`

## Google Login setup

1. Create an OAuth Client ID in Google Cloud Console (type: Web application).
2. Add your website origin (for local dev: `http://localhost:10000`, for Render: your deployed domain).
3. Set `GOOGLE_CLIENT_ID` on the server.
4. Set `GOOGLE_ALLOWED_DOMAIN` to your school domain if you want domain-restricted sign-in.
5. Set `AUTH_SESSION_SECRET` to a long random value (at least 32 chars).
6. Optional: set `INITIAL_ADMIN_EMAIL` to seed your first Admin role, then manage roles in Admin menu.

## Render deployment notes

- Create a **Web Service** from this GitHub repository.
- Build command: `npm install`
- Start command: `npm start`
- Set `DATABASE_URL` in Render environment variables.
- Keep service port internal; Render injects `PORT` automatically.

## Security note

Do not hardcode database credentials in source files. Keep credentials in environment variables only.
