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

Example:

```
DATABASE_URL=postgresql://username:password@host:5432/database
PORT=10000
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
- `http://localhost:10000/student_upload.html`
- `http://localhost:10000/timetable_upload.html`

## API routes

- `GET /health`
- `GET /api/staff_upload/all`
- `POST /api/staff_upload`
- `GET /api/student_upload/all`
- `POST /api/student_upload`
- `GET /api/timetable/all`
- `POST /api/upload_timetable`
- `PUT /api/upload_timetable/row/:teacherKey`

## Render deployment notes

- Create a **Web Service** from this GitHub repository.
- Build command: `npm install`
- Start command: `npm start`
- Set `DATABASE_URL` in Render environment variables.
- Keep service port internal; Render injects `PORT` automatically.

## Security note

Do not hardcode database credentials in source files. Keep credentials in environment variables only.
