require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const port = Number(process.env.PORT || 10000);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Add it as an environment variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname)));

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_ALLOWED_DOMAIN = String(process.env.GOOGLE_ALLOWED_DOMAIN || 'westlandhigh.school.nz').trim().toLowerCase();
const INITIAL_ADMIN_EMAIL = String(process.env.INITIAL_ADMIN_EMAIL || 'vanessapringle@westlandhigh.school.nz').trim().toLowerCase();
const SESSION_COOKIE_NAME = 'kamar_auth';
const AUTH_SESSION_SECRET = String(process.env.AUTH_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

if (!process.env.AUTH_SESSION_SECRET) {
  console.warn('AUTH_SESSION_SECRET is not set. Sessions will reset on server restart.');
}

const STAFF_FIELDS = {
  code: ['code', 'staffcode'],
  last_name: ['lastname', 'surname', 'familyname'],
  first_name: ['firstname', 'givenname', 'forename'],
  title: ['title'],
  email_school: ['emailschool', 'email', 'schoolemail', 'emailaddress']
};

const STUDENT_DETAILS_FIELDS = {
  id_number: ['studentid', 'student_id', 'idnumber', 'id_number', 'student id', 'id number'],
  last_name: ['lastname', 'last_name', 'last name', 'surname', 'familyname'],
  first_name: ['firstname', 'first_name', 'first name', 'givenname', 'forename'],
  gender: ['gender', 'sex'],
  year_level: ['level', 'yearlevel', 'year_level', 'year'],
  tutor: ['tutor', 'formclass', 'form_class', 'form class'],
  timetable_class: ['timetableclass', 'timetable_class', 'timetable class', 'ttclass'],
  email_school: ['studentemailschool', 'student_email_school', 'student email school', 'studentemail', 'emailschool', 'email_school', 'email']
};

const STUDENT_PERIOD_KEYS = [
  'mon_p1_1', 'mon_p1_2', 'mon_p2', 'mon_i', 'mon_p3', 'mon_p4', 'mon_l', 'mon_p5',
  'tue_p1_1', 'tue_p1_2', 'tue_p2', 'tue_i', 'tue_p3', 'tue_p4', 'tue_l', 'tue_p5',
  'wed_p1_1', 'wed_p1_2', 'wed_p2', 'wed_i', 'wed_p3', 'wed_p4', 'wed_l', 'wed_p5',
  'thu_p1_1', 'thu_p1_2', 'thu_p2', 'thu_i', 'thu_p3', 'thu_p4', 'thu_l', 'thu_p5',
  'fri_p1_1', 'fri_p1_2', 'fri_p2', 'fri_i', 'fri_p3', 'fri_p4', 'fri_l', 'fri_p5'
];

const STUDENT_BASE_KEYS = ['student_name', 'id_number', 'form_class', 'year_level'];
const STUDENT_KEYS = [...STUDENT_BASE_KEYS, ...STUDENT_PERIOD_KEYS];

const STUDENT_ALIASES = {
  student_name: ['studentname', 'name'],
  id_number: ['idnumber', 'studentid', 'id'],
  form_class: ['formclass', 'form', 'class'],
  year_level: ['yearlevel', 'year'],
  email_school: ['studentemailschool', 'studentemail', 'emailschool', 'email', 'schoolemail']
};

const LEGACY_STUDENT_TABLES = [
  'student_upload',
  'student_timetable_upload',
  'student_timetable',
  'student_timetables'
];

const LEGACY_TIMETABLE_TABLES = [
  'timetable_upload',
  'upload_timetable',
  'teacher_timetable_upload',
  'teacher_timetable',
  'timetable'
];

const MANAGED_ROLES = ['admin', 'technician'];
const ROLE_PERMISSION_KEYS = [
  'homepage',
  'staff_upload',
  'student_upload',
  'student_timetable',
  'staff_timetable',
  'admin_menu'
];
const DEFAULT_ROLE_PERMISSIONS = {
  admin: {
    homepage: true,
    staff_upload: true,
    student_upload: true,
    student_timetable: true,
    staff_timetable: true,
    admin_menu: true
  },
  technician: {
    homepage: true,
    staff_upload: true,
    student_upload: true,
    student_timetable: true,
    staff_timetable: true,
    admin_menu: false
  }
};

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseUploadDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildIndexLookup(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    map.set(normalizeKey(header), index);
  });
  return map;
}

function pickValueByAliases(row, indexLookup, aliases) {
  for (const alias of aliases) {
    const idx = indexLookup.get(normalizeKey(alias));
    if (idx == null) continue;
    return String(row[idx] || '').trim();
  }
  return '';
}

function mapStaffRow(row, indexLookup) {
  const mapped = {};
  Object.keys(STAFF_FIELDS).forEach((field) => {
    mapped[field] = pickValueByAliases(row, indexLookup, STAFF_FIELDS[field]);
  });
  return mapped;
}

function mapStudentDetailsRow(row, indexLookup) {
  const mapped = {};
  Object.keys(STUDENT_DETAILS_FIELDS).forEach((field) => {
    mapped[field] = pickValueByAliases(row, indexLookup, STUDENT_DETAILS_FIELDS[field]);
  });
  mapped.id_number = String(mapped.id_number || '').trim();
  mapped.email_school = String(mapped.email_school || '').trim().toLowerCase();
  return mapped;
}

function buildStudentHeaderMap(headers) {
  const headerToKey = new Map();
  const normalizedTargets = new Map(STUDENT_KEYS.map((key) => [normalizeKey(key), key]));

  headers.forEach((header, idx) => {
    const normalized = normalizeKey(header);

    if (normalizedTargets.has(normalized)) {
      headerToKey.set(idx, normalizedTargets.get(normalized));
      return;
    }

    for (const [target, aliases] of Object.entries(STUDENT_ALIASES)) {
      if (aliases.includes(normalized)) {
        headerToKey.set(idx, target);
        return;
      }
    }
  });

  return headerToKey;
}

function mapStudentRow(row, headerMap) {
  const mapped = Object.fromEntries(STUDENT_KEYS.map((key) => [key, '']));

  for (const [idx, key] of headerMap.entries()) {
    mapped[key] = String(row[idx] || '').trim();
  }

  return mapped;
}

async function syncStudentEmailsFromStudentUpload() {
  const sourceRows = await pool.query(`
    SELECT id_number, email_school
    FROM student_details_upload
    WHERE status = 'Current';
  `);

  const updates = new Map();
  let skippedMissingFields = 0;

  for (const row of sourceRows.rows || []) {
    const studentId = String(row.id_number || '').trim();
    const email = String(row.email_school || '').trim().toLowerCase();

    if (!studentId || !email) {
      skippedMissingFields += 1;
      continue;
    }

    updates.set(studentId, email);
  }

  const payload = Array.from(updates.entries());
  let updated = 0;
  let notFound = 0;

  await withTransaction(async (client) => {
    for (const [studentId, email] of payload) {
      const result = await client.query(
        `
        UPDATE student_upload
        SET email_school = $2,
            updated_at = NOW()
        WHERE trim(lower(coalesce(id_number, ''))) = trim(lower($1));
        `,
        [studentId, email]
      );

      if ((result.rowCount || 0) > 0) updated += result.rowCount || 0;
      else notFound += 1;
    }
  });

  return {
    processed: payload.length,
    updated,
    not_found_in_student_upload: notFound,
    skipped_missing_fields: skippedMissingFields
  };
}

function getNormalizedRowValue(row, aliases) {
  const normalizedMap = new Map();
  Object.entries(row || {}).forEach(([key, value]) => {
    const normalized = normalizeKey(key);
    if (normalized && !normalizedMap.has(normalized)) {
      normalizedMap.set(normalized, value);
    }
  });

  for (const alias of aliases) {
    const hit = normalizedMap.get(normalizeKey(alias));
    if (hit !== undefined) return hit;
  }

  return null;
}

function normalizeStudentRecord(row) {
  const normalized = {
    id: getNormalizedRowValue(row, ['id']),
    status: getNormalizedRowValue(row, ['status']) || 'Current',
    upload_year: getNormalizedRowValue(row, ['upload_year', 'uploadyear']),
    upload_term: getNormalizedRowValue(row, ['upload_term', 'uploadterm']),
    upload_date: getNormalizedRowValue(row, ['upload_date', 'uploaddate'])
  };

  STUDENT_KEYS.forEach((key) => {
    normalized[key] = getNormalizedRowValue(row, [key]);
  });

  normalized.student_name =
    normalized.student_name || getNormalizedRowValue(row, ['student_name', 'studentname', 'name']);
  normalized.id_number =
    normalized.id_number || getNormalizedRowValue(row, ['id_number', 'idnumber', 'studentid', 'id']);
  normalized.form_class =
    normalized.form_class || getNormalizedRowValue(row, ['form_class', 'formclass', 'form', 'class']);
  normalized.year_level =
    normalized.year_level || getNormalizedRowValue(row, ['year_level', 'yearlevel', 'year']);
  normalized.email_school =
    getNormalizedRowValue(row, ['email_school', 'emailschool', 'student_email_school', 'studentemailschool', 'email']);

  return normalized;
}

function isSafeTableName(tableName) {
  return /^[a-z_][a-z0-9_]*$/.test(tableName);
}

async function tableExists(client, tableName) {
  const { rows } = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists;', [`public.${tableName}`]);
  return Boolean(rows[0]?.exists);
}

async function fetchStudentsWithFallback() {
  const client = await pool.connect();
  try {
    for (const tableName of LEGACY_STUDENT_TABLES) {
      if (!isSafeTableName(tableName)) continue;
      if (!(await tableExists(client, tableName))) continue;

      const { rows } = await client.query(`SELECT * FROM ${tableName};`);
      if (!rows || rows.length === 0) continue;

      const normalizedRows = rows.map(normalizeStudentRecord);
      normalizedRows.sort((a, b) => {
        const aName = String(a.student_name || '').toLowerCase();
        const bName = String(b.student_name || '').toLowerCase();
        return aName.localeCompare(bName);
      });

      return normalizedRows;
    }

    return [];
  } finally {
    client.release();
  }
}

function normalizeTimetableRecord(row) {
  const teacher =
    String(getNormalizedRowValue(row, ['teacher', 'teacher_code', 'teachercode', 'staffcode', 'code']) || '')
      .trim()
      .toLowerCase();

  const teacherName = String(
    getNormalizedRowValue(row, ['teacher_name', 'teachername', 'staffname', 'name']) || ''
  ).trim();

  const status = String(getNormalizedRowValue(row, ['status']) || 'Current').trim();
  const uploadYear = getNormalizedRowValue(row, ['upload_year', 'uploadyear']);
  const uploadTerm = getNormalizedRowValue(row, ['upload_term', 'uploadterm']);
  const uploadDate = getNormalizedRowValue(row, ['upload_date', 'uploaddate']);

  const dataCandidate = getNormalizedRowValue(row, ['data']);
  let data = {};

  if (dataCandidate && typeof dataCandidate === 'object' && !Array.isArray(dataCandidate)) {
    data = dataCandidate;
  } else {
    Object.keys(row || {}).forEach((key) => {
      if (['teacher', 'teacher_name', 'status', 'upload_year', 'upload_term', 'upload_date', 'data'].includes(normalizeKey(key))) {
        return;
      }
      data[key] = row[key];
    });
  }

  return {
    ...data,
    Teacher: teacher,
    Teacher_Name: teacherName || String(data.Teacher_Name || data.teacher_name || '').trim(),
    status,
    upload_year: uploadYear,
    upload_term: uploadTerm,
    upload_date: uploadDate
  };
}

async function fetchTimetableWithFallback() {
  const client = await pool.connect();
  try {
    for (const tableName of LEGACY_TIMETABLE_TABLES) {
      if (!isSafeTableName(tableName)) continue;
      if (!(await tableExists(client, tableName))) continue;

      if (tableName === 'timetable_upload') {
        const { rows } = await client.query(`
          SELECT teacher, teacher_name, data, status, upload_year, upload_term, upload_date
          FROM timetable_upload
          ORDER BY teacher_name ASC NULLS LAST, teacher ASC;
        `);

        if (!rows || rows.length === 0) continue;

        return rows.map((row) => {
          const payload = row.data && typeof row.data === 'object' ? row.data : {};
          return {
            ...payload,
            Teacher: row.teacher,
            Teacher_Name: row.teacher_name || payload.Teacher_Name || payload.teacher_name || '',
            status: row.status,
            upload_year: row.upload_year,
            upload_term: row.upload_term,
            upload_date: row.upload_date
          };
        });
      }

      const { rows } = await client.query(`SELECT * FROM ${tableName};`);
      if (!rows || rows.length === 0) continue;

      const normalizedRows = rows.map(normalizeTimetableRecord).filter((row) => String(row.Teacher || '').trim());
      normalizedRows.sort((a, b) => {
        const aName = String(a.Teacher_Name || '').toLowerCase();
        const bName = String(b.Teacher_Name || '').toLowerCase();
        return aName.localeCompare(bName);
      });

      return normalizedRows;
    }

    return [];
  } finally {
    client.release();
  }
}

function toPositiveIntOrDefault(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function includesText(value, q) {
  return String(value || '').toLowerCase().includes(String(q || '').toLowerCase());
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (text.length % 4)) % 4;
  const padded = `${text}${'='.repeat(padLength)}`;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function parseCookieHeader(cookieHeader) {
  const out = {};
  String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      out[key] = decodeURIComponent(value);
    });
  return out;
}

function signSessionBody(body) {
  return crypto.createHmac('sha256', AUTH_SESSION_SECRET).update(body).digest('hex');
}

function createSessionToken(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = signSessionBody(body);
  return `${body}.${signature}`;
}

function readSessionFromRequest(req) {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;

  const expectedSignature = signSessionBody(body);
  if (signature !== expectedSignature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload || typeof payload !== 'object') return null;
    if (Number(payload.expires_at || 0) < Date.now()) return null;
    return payload;
  } catch (_err) {
    return null;
  }
}

function clearAuthCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

async function resolveUserAccessByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) {
    return { role: 'guest', in_staff_upload: false, in_student_upload: false };
  }

  const [staffCheck, studentCheck] = await Promise.all([
    pool.query(
      `
      SELECT EXISTS(
        SELECT 1
        FROM staff_upload
        WHERE lower(coalesce(email_school, '')) = $1
          AND status = 'Current'
      ) AS present;
      `,
      [normalized]
    ),
    pool.query(
      `
      SELECT EXISTS(
        SELECT 1
        FROM student_details_upload
        WHERE lower(coalesce(email_school, '')) = $1
          AND status = 'Current'
      ) AS present;
      `,
      [normalized]
    )
  ]);

  const inStaffUpload = Boolean(staffCheck.rows[0]?.present);
  const inStudentUpload = Boolean(studentCheck.rows[0]?.present);
  const role = inStaffUpload ? 'staff' : (inStudentUpload ? 'student' : 'guest');

  return {
    role,
    in_staff_upload: inStaffUpload,
    in_student_upload: inStudentUpload
  };
}

function toPermissionObject(row) {
  const out = {};
  ROLE_PERMISSION_KEYS.forEach((key) => {
    out[key] = Boolean(row && row[key]);
  });
  out.homepage = true;
  return out;
}

async function getRolePermissions(roleName) {
  const role = String(roleName || '').trim().toLowerCase();
  if (!MANAGED_ROLES.includes(role)) {
    return toPermissionObject({ homepage: true });
  }

  const { rows } = await pool.query(
    `
    SELECT role_name, homepage, staff_upload, student_upload, student_timetable, staff_timetable, admin_menu
    FROM app_role_permissions
    WHERE role_name = $1
    LIMIT 1;
    `,
    [role]
  );

  if (!rows[0]) {
    return toPermissionObject(DEFAULT_ROLE_PERMISSIONS[role] || { homepage: true });
  }

  return toPermissionObject(rows[0]);
}

async function resolveManagedRoleForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;

  const { rows } = await pool.query(
    `
    SELECT role_name
    FROM app_user_roles
    WHERE lower(user_email) = $1
      AND role_name = ANY($2::text[])
    ORDER BY CASE role_name WHEN 'admin' THEN 0 WHEN 'technician' THEN 1 ELSE 9 END;
    `,
    [normalized, MANAGED_ROLES]
  );

  if (!rows.length) return null;
  return String(rows[0].role_name || '').trim().toLowerCase() || null;
}

function requireSession(req, res, next) {
  const session = readSessionFromRequest(req);
  if (!session) {
    clearAuthCookie(res);
    res.status(401).json({ success: false, error: 'You must be signed in.' });
    return;
  }

  req.sessionUser = session;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.sessionUser) {
    res.status(401).json({ success: false, error: 'Missing session context.' });
    return;
  }

  const role = String(req.sessionUser.role || '').trim().toLowerCase();
  if (role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access is required.' });
    return;
  }

  next();
}

function getTimetableDataColumns(row) {
  return Object.keys(row || {}).filter((key) => {
    const normalized = normalizeKey(key);
    return ![
      'teacher',
      'teachername',
      'status',
      'uploadyear',
      'uploadterm',
      'uploaddate'
    ].includes(normalized);
  });
}

function mapTimetableRow(headers, row) {
  const mapped = {};
  headers.forEach((header, idx) => {
    const key = String(header || '').trim();
    if (!key) return;
    mapped[key] = String(row[idx] || '').trim();
  });
  return mapped;
}

function getTimetableTeacherKey(rowObj) {
  const aliases = ['teacher', 'teachercode', 'code', 'staffcode'];
  const entries = Object.entries(rowObj);

  for (const [key, value] of entries) {
    if (aliases.includes(normalizeKey(key))) {
      return String(value || '').trim();
    }
  }

  return '';
}

function getTimetableTeacherName(rowObj) {
  const aliases = ['teachername', 'teacher_name', 'staffname', 'name'];
  const entries = Object.entries(rowObj);

  for (const [key, value] of entries) {
    if (aliases.includes(normalizeKey(key))) {
      return String(value || '').trim();
    }
  }

  return '';
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_upload (
      id BIGSERIAL PRIMARY KEY,
      code TEXT,
      last_name TEXT,
      first_name TEXT,
      title TEXT,
      email_school TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'Current',
      upload_year INTEGER,
      upload_term TEXT,
      upload_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_details_upload (
      id BIGSERIAL PRIMARY KEY,
      id_number TEXT UNIQUE,
      last_name TEXT,
      first_name TEXT,
      gender TEXT,
      year_level TEXT,
      tutor TEXT,
      timetable_class TEXT,
      email_school TEXT,
      status TEXT NOT NULL DEFAULT 'Current',
      upload_year INTEGER,
      upload_term TEXT,
      upload_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_upload (
      id BIGSERIAL PRIMARY KEY,
      student_name TEXT,
      id_number TEXT UNIQUE,
      email_school TEXT,
      form_class TEXT,
      year_level TEXT,
      mon_p1_1 TEXT, mon_p1_2 TEXT, mon_p2 TEXT, mon_i TEXT, mon_p3 TEXT, mon_p4 TEXT, mon_l TEXT, mon_p5 TEXT,
      tue_p1_1 TEXT, tue_p1_2 TEXT, tue_p2 TEXT, tue_i TEXT, tue_p3 TEXT, tue_p4 TEXT, tue_l TEXT, tue_p5 TEXT,
      wed_p1_1 TEXT, wed_p1_2 TEXT, wed_p2 TEXT, wed_i TEXT, wed_p3 TEXT, wed_p4 TEXT, wed_l TEXT, wed_p5 TEXT,
      thu_p1_1 TEXT, thu_p1_2 TEXT, thu_p2 TEXT, thu_i TEXT, thu_p3 TEXT, thu_p4 TEXT, thu_l TEXT, thu_p5 TEXT,
      fri_p1_1 TEXT, fri_p1_2 TEXT, fri_p2 TEXT, fri_i TEXT, fri_p3 TEXT, fri_p4 TEXT, fri_l TEXT, fri_p5 TEXT,
      status TEXT NOT NULL DEFAULT 'Current',
      upload_year INTEGER,
      upload_term TEXT,
      upload_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE student_upload ADD COLUMN IF NOT EXISTS email_school TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_upload (
      teacher TEXT PRIMARY KEY,
      teacher_name TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'Current',
      upload_year INTEGER,
      upload_term TEXT,
      upload_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_roles (
      role_name TEXT PRIMARY KEY,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_user_roles (
      user_email TEXT NOT NULL,
      role_name TEXT NOT NULL REFERENCES app_roles(role_name) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_email, role_name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_role_permissions (
      role_name TEXT PRIMARY KEY REFERENCES app_roles(role_name) ON DELETE CASCADE,
      homepage BOOLEAN NOT NULL DEFAULT TRUE,
      staff_upload BOOLEAN NOT NULL DEFAULT FALSE,
      student_upload BOOLEAN NOT NULL DEFAULT FALSE,
      student_timetable BOOLEAN NOT NULL DEFAULT FALSE,
      staff_timetable BOOLEAN NOT NULL DEFAULT FALSE,
      admin_menu BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await withTransaction(async (client) => {
    for (const role of MANAGED_ROLES) {
      await client.query(
        `
        INSERT INTO app_roles (role_name, description, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (role_name)
        DO UPDATE SET
          description = EXCLUDED.description,
          updated_at = NOW();
        `,
        [role, role === 'admin' ? 'System administrator' : 'Technical support staff']
      );

      const defaults = DEFAULT_ROLE_PERMISSIONS[role];
      await client.query(
        `
        INSERT INTO app_role_permissions (
          role_name, homepage, staff_upload, student_upload, student_timetable, staff_timetable, admin_menu, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (role_name)
        DO NOTHING;
        `,
        [
          role,
          Boolean(defaults.homepage),
          Boolean(defaults.staff_upload),
          Boolean(defaults.student_upload),
          Boolean(defaults.student_timetable),
          Boolean(defaults.staff_timetable),
          Boolean(defaults.admin_menu)
        ]
      );
    }

    if (INITIAL_ADMIN_EMAIL) {
      await client.query(
        `
        INSERT INTO app_user_roles (user_email, role_name, updated_at)
        VALUES ($1, 'admin', NOW())
        ON CONFLICT (user_email, role_name)
        DO UPDATE SET updated_at = NOW();
        `,
        [INITIAL_ADMIN_EMAIL]
      );
    }
  });
}

app.get('/api/auth/google/config', (_req, res) => {
  res.json({
    enabled: Boolean(GOOGLE_CLIENT_ID),
    client_id: GOOGLE_CLIENT_ID || null,
    allowed_domain: GOOGLE_ALLOWED_DOMAIN || null
  });
});

app.post('/api/auth/google-login', async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID || !googleClient) {
      res.status(503).json({ success: false, error: 'Google Login is not configured on this server.' });
      return;
    }

    const credential = String(req.body?.credential || '').trim();
    if (!credential) {
      res.status(400).json({ success: false, error: 'Missing Google credential token.' });
      return;
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload() || {};

    const email = String(payload.email || '').trim().toLowerCase();
    const emailVerified = Boolean(payload.email_verified);
    const hostedDomain = String(payload.hd || '').trim().toLowerCase();
    const emailDomain = email.includes('@') ? email.split('@')[1] : '';
    const domainAllowed = !GOOGLE_ALLOWED_DOMAIN || hostedDomain === GOOGLE_ALLOWED_DOMAIN || emailDomain === GOOGLE_ALLOWED_DOMAIN;

    if (!email || !emailVerified) {
      res.status(403).json({ success: false, error: 'Google account email is missing or not verified.' });
      return;
    }

    if (!domainAllowed) {
      res.status(403).json({ success: false, error: `Sign-in restricted to ${GOOGLE_ALLOWED_DOMAIN} accounts.` });
      return;
    }

    const access = await resolveUserAccessByEmail(email);
    if (!access.in_staff_upload) {
      res.status(403).json({ success: false, error: 'Your account must exist in the current Staff Upload list.' });
      return;
    }

    const managedRole = await resolveManagedRoleForEmail(email);
    if (!managedRole || !MANAGED_ROLES.includes(managedRole)) {
      res.status(403).json({ success: false, error: 'Only Admin and Technician users can sign in.' });
      return;
    }

    const permissions = await getRolePermissions(managedRole);
    const now = Date.now();
    const sessionPayload = {
      email,
      name: String(payload.name || '').trim() || email,
      picture: String(payload.picture || '').trim() || null,
      hosted_domain: hostedDomain || null,
      role: managedRole,
      permissions,
      in_staff_upload: access.in_staff_upload,
      in_student_upload: access.in_student_upload,
      issued_at: now,
      expires_at: now + SESSION_MAX_AGE_MS
    };

    const sessionToken = createSessionToken(sessionPayload);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
      path: '/'
    });

    res.json({ success: true, user: sessionPayload });
  } catch (error) {
    res.status(401).json({ success: false, error: 'Google sign-in verification failed.' });
  }
});

app.get('/api/auth/session', (req, res) => {
  const session = readSessionFromRequest(req);
  if (!session) {
    clearAuthCookie(res);
    res.status(401).json({ success: false, user: null });
    return;
  }

  res.json({ success: true, user: session });
});

app.get('/api/user_roles/options', requireSession, requireAdmin, async (_req, res) => {
  try {
    const [staffRows, roleRows] = await Promise.all([
      pool.query(
        `
        SELECT email_school, first_name, last_name, code
        FROM staff_upload
        WHERE status = 'Current'
          AND lower(coalesce(email_school, '')) <> ''
        ORDER BY last_name ASC NULLS LAST, first_name ASC NULLS LAST;
        `
      ),
      pool.query(`SELECT role_name FROM app_roles WHERE role_name = ANY($1::text[]) ORDER BY role_name ASC;`, [MANAGED_ROLES])
    ]);

    const users = staffRows.rows.map((row) => {
      const email = String(row.email_school || '').trim().toLowerCase();
      const name = [row.first_name, row.last_name].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
      const code = String(row.code || '').trim();
      const labelCore = name || email;
      const label = code ? `${labelCore} (${code})` : labelCore;
      return { value: email, label };
    });

    const roles = roleRows.rows.map((row) => ({ role_name: String(row.role_name || '').toLowerCase() }));
    res.json({ success: true, users, roles });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load role assignment options.' });
  }
});

app.get('/api/user_roles/all', requireSession, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        ur.user_email,
        ARRAY_AGG(ur.role_name ORDER BY CASE ur.role_name WHEN 'admin' THEN 0 WHEN 'technician' THEN 1 ELSE 9 END) AS roles,
        MIN(s.first_name) AS first_name,
        MIN(s.last_name) AS last_name
      FROM app_user_roles ur
      LEFT JOIN staff_upload s ON lower(coalesce(s.email_school, '')) = lower(ur.user_email)
      WHERE ur.role_name = ANY($1::text[])
      GROUP BY ur.user_email
      ORDER BY ur.user_email ASC;
      `,
      [MANAGED_ROLES]
    );

    const users = rows.map((row) => {
      const email = String(row.user_email || '').trim().toLowerCase();
      const name = [row.first_name, row.last_name].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
      return {
        user_type: 'staff',
        user_identifier: email,
        user_label: name ? `${name} (${email})` : email,
        roles: Array.isArray(row.roles) ? row.roles.map((r) => String(r || '').toLowerCase()) : []
      };
    });

    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load user roles.' });
  }
});

app.post('/api/user_roles/add', requireSession, requireAdmin, async (req, res) => {
  try {
    const userType = String(req.body?.user_type || 'staff').trim().toLowerCase();
    const email = String(req.body?.user_identifier || '').trim().toLowerCase();
    const roleName = String(req.body?.role_name || '').trim().toLowerCase();

    if (userType !== 'staff') {
      res.status(400).json({ success: false, error: 'Only staff role assignments are supported.' });
      return;
    }
    if (!email) {
      res.status(400).json({ success: false, error: 'User email is required.' });
      return;
    }
    if (!MANAGED_ROLES.includes(roleName)) {
      res.status(400).json({ success: false, error: 'Role must be Admin or Technician.' });
      return;
    }

    const exists = await pool.query(
      `
      SELECT 1
      FROM staff_upload
      WHERE lower(coalesce(email_school, '')) = $1
        AND status = 'Current'
      LIMIT 1;
      `,
      [email]
    );
    if (!exists.rows.length) {
      res.status(404).json({ success: false, error: 'User not found in current Staff Upload.' });
      return;
    }

    await pool.query(
      `
      INSERT INTO app_user_roles (user_email, role_name, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_email, role_name)
      DO UPDATE SET updated_at = NOW();
      `,
      [email, roleName]
    );

    res.json({ success: true, message: `Assigned ${roleName} role to ${email}.` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to add role.' });
  }
});

app.delete('/api/user_roles/:userType/:userIdentifier', requireSession, requireAdmin, async (req, res) => {
  try {
    const userType = String(req.params.userType || '').trim().toLowerCase();
    const email = String(req.params.userIdentifier || '').trim().toLowerCase();
    if (userType !== 'staff') {
      res.status(400).json({ success: false, error: 'Only staff role assignments are supported.' });
      return;
    }
    if (!email) {
      res.status(400).json({ success: false, error: 'User email is required.' });
      return;
    }

    await pool.query(`DELETE FROM app_user_roles WHERE lower(user_email) = $1;`, [email]);
    res.json({ success: true, message: `Removed assigned roles for ${email}.` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to remove user roles.' });
  }
});

app.get('/api/permissions/all', requireSession, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT role_name, homepage, staff_upload, student_upload, student_timetable, staff_timetable, admin_menu
      FROM app_role_permissions
      WHERE role_name = ANY($1::text[])
      ORDER BY CASE role_name WHEN 'admin' THEN 0 WHEN 'technician' THEN 1 ELSE 9 END;
      `,
      [MANAGED_ROLES]
    );

    res.json({ success: true, routes: ROLE_PERMISSION_KEYS, roles: rows.map((row) => ({ ...row, homepage: true })) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load permissions.' });
  }
});

app.put('/api/permissions/:roleName', requireSession, requireAdmin, async (req, res) => {
  try {
    const roleName = String(req.params.roleName || '').trim().toLowerCase();
    if (!MANAGED_ROLES.includes(roleName)) {
      res.status(400).json({ success: false, error: 'Unknown role.' });
      return;
    }

    const permissions = {
      homepage: true,
      staff_upload: Boolean(req.body?.staff_upload),
      student_upload: Boolean(req.body?.student_upload),
      student_timetable: Boolean(req.body?.student_timetable),
      staff_timetable: Boolean(req.body?.staff_timetable),
      admin_menu: Boolean(req.body?.admin_menu)
    };

    await pool.query(
      `
      UPDATE app_role_permissions
      SET homepage = $2,
          staff_upload = $3,
          student_upload = $4,
          student_timetable = $5,
          staff_timetable = $6,
          admin_menu = $7,
          updated_at = NOW()
      WHERE role_name = $1;
      `,
      [
        roleName,
        permissions.homepage,
        permissions.staff_upload,
        permissions.student_upload,
        permissions.student_timetable,
        permissions.staff_timetable,
        permissions.admin_menu
      ]
    );

    res.json({ success: true, role_name: roleName, permissions });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update permissions.' });
  }
});

app.post('/api/permissions/reset', requireSession, requireAdmin, async (_req, res) => {
  try {
    await withTransaction(async (client) => {
      for (const role of MANAGED_ROLES) {
        const defaults = DEFAULT_ROLE_PERMISSIONS[role];
        await client.query(
          `
          INSERT INTO app_role_permissions (
            role_name, homepage, staff_upload, student_upload, student_timetable, staff_timetable, admin_menu, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
          ON CONFLICT (role_name)
          DO UPDATE SET
            homepage = EXCLUDED.homepage,
            staff_upload = EXCLUDED.staff_upload,
            student_upload = EXCLUDED.student_upload,
            student_timetable = EXCLUDED.student_timetable,
            staff_timetable = EXCLUDED.staff_timetable,
            admin_menu = EXCLUDED.admin_menu,
            updated_at = NOW();
          `,
          [
            role,
            Boolean(defaults.homepage),
            Boolean(defaults.staff_upload),
            Boolean(defaults.student_upload),
            Boolean(defaults.student_timetable),
            Boolean(defaults.staff_timetable),
            Boolean(defaults.admin_menu)
          ]
        );
      }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reset permissions.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/staff_upload/all', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, code, last_name, first_name, title, email_school, status, upload_year, upload_term, upload_date
      FROM staff_upload
      ORDER BY last_name ASC, first_name ASC;
    `);
    res.json({ staff: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load staff upload data.' });
  }
});

app.post('/api/staff_upload', async (req, res) => {
  const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
  const uploadedRows = Array.isArray(req.body?.staff) ? req.body.staff : [];

  if (headers.length === 0 || uploadedRows.length === 0) {
    res.status(400).json({ error: 'Missing headers or staff rows.' });
    return;
  }

  const uploadYear = Number.isInteger(Number(req.body?.uploadYear)) ? Number(req.body.uploadYear) : null;
  const uploadTerm = String(req.body?.uploadTerm || '').trim() || null;
  const uploadDate = parseUploadDate(req.body?.uploadDate);

  const indexLookup = buildIndexLookup(headers);
  const deduped = new Map();
  let skippedNoIdentifier = 0;
  let duplicateIdentifiers = 0;
  let duplicateEmails = 0;
  let duplicateCodes = 0;

  for (const row of uploadedRows) {
    if (!Array.isArray(row)) continue;
    const mapped = mapStaffRow(row, indexLookup);
    const emailKey = String(mapped.email_school || '').trim().toLowerCase();
    const codeKey = String(mapped.code || '').trim().toLowerCase();
    const identifier = emailKey ? `email:${emailKey}` : (codeKey ? `code:${codeKey}` : '');

    if (!identifier) {
      skippedNoIdentifier += 1;
      continue;
    }

    if (deduped.has(identifier)) {
      duplicateIdentifiers += 1;
      if (emailKey) duplicateEmails += 1;
      else duplicateCodes += 1;
      continue;
    }

    deduped.set(identifier, mapped);
  }

  const records = Array.from(deduped.values());

  try {
    const result = await withTransaction(async (client) => {
      let inserted = 0;
      let updated = 0;

      for (const record of records) {
        const code = String(record.code || '').trim() || null;
        const email = String(record.email_school || '').trim().toLowerCase() || null;

        let existing = null;
        if (email) {
          const foundByEmail = await client.query(
            `SELECT id FROM staff_upload WHERE lower(coalesce(email_school, '')) = $1 LIMIT 1;`,
            [email]
          );
          existing = foundByEmail.rows[0] || null;
        }
        if (!existing && code) {
          const foundByCode = await client.query(
            `SELECT id FROM staff_upload WHERE lower(coalesce(code, '')) = $1 LIMIT 1;`,
            [code.toLowerCase()]
          );
          existing = foundByCode.rows[0] || null;
        }

        if (existing) {
          await client.query(
            `
            UPDATE staff_upload
            SET code = $2,
                last_name = $3,
                first_name = $4,
                title = $5,
                email_school = COALESCE($6, email_school),
                status = 'Current',
                upload_year = $7,
                upload_term = $8,
                upload_date = $9,
                updated_at = NOW()
            WHERE id = $1;
            `,
            [
              existing.id,
              code,
              record.last_name || null,
              record.first_name || null,
              record.title || null,
              email,
              uploadYear,
              uploadTerm,
              uploadDate
            ]
          );
          updated += 1;
        } else {
          await client.query(
            `
            INSERT INTO staff_upload (
              code, last_name, first_name, title, email_school, status, upload_year, upload_term, upload_date, updated_at
            ) VALUES ($1,$2,$3,$4,$5,'Current',$6,$7,$8,NOW());
            `,
            [
              code,
              record.last_name || null,
              record.first_name || null,
              record.title || null,
              email,
              uploadYear,
              uploadTerm,
              uploadDate
            ]
          );
          inserted += 1;
        }
      }

      let markedNotCurrent = 0;
      const uploadedEmails = records.map((r) => String(r.email_school || '').trim().toLowerCase()).filter(Boolean);
      const uploadedCodes = records.map((r) => String(r.code || '').trim().toLowerCase()).filter(Boolean);

      if (uploadedEmails.length > 0 || uploadedCodes.length > 0) {
        const mark = await client.query(
          `
          UPDATE staff_upload
          SET status = 'Not Current', updated_at = NOW()
          WHERE status <> 'Not Current'
            AND NOT (
              (lower(coalesce(email_school, '')) <> '' AND lower(email_school) = ANY($1::text[]))
              OR
              (lower(coalesce(code, '')) <> '' AND lower(code) = ANY($2::text[]))
            );
          `,
          [uploadedEmails, uploadedCodes]
        );
        markedNotCurrent = mark.rowCount || 0;
      }

      return { inserted, updated, markedNotCurrent };
    });

    res.json({
      success: true,
      processed: records.length,
      inserted: result.inserted,
      updated: result.updated,
      marked_not_current: result.markedNotCurrent,
      skipped_no_email: skippedNoIdentifier,
      skipped_no_identifier: skippedNoIdentifier,
      duplicate_emails_in_upload: duplicateEmails,
      duplicate_identifiers_in_upload: duplicateIdentifiers,
      duplicate_codes_in_upload: duplicateCodes,
      upload_year: uploadYear,
      upload_term: uploadTerm,
      upload_date: uploadDate
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save staff upload data.' });
  }
});

app.get('/api/student_details_upload/all', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, id_number, last_name, first_name, gender, year_level, tutor, timetable_class, email_school,
             status, upload_year, upload_term, upload_date
      FROM student_details_upload
      ORDER BY last_name ASC, first_name ASC;
    `);
    res.json({ students: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load student upload data.' });
  }
});

app.post('/api/student_details_upload', async (req, res) => {
  const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
  const uploadedRows = Array.isArray(req.body?.students) ? req.body.students : [];

  if (headers.length === 0 || uploadedRows.length === 0) {
    res.status(400).json({ error: 'Missing headers or student rows.' });
    return;
  }

  const uploadYear = Number.isInteger(Number(req.body?.uploadYear)) ? Number(req.body.uploadYear) : null;
  const uploadTerm = String(req.body?.uploadTerm || '').trim() || null;
  const uploadDate = parseUploadDate(req.body?.uploadDate);

  const indexLookup = buildIndexLookup(headers);
  const deduped = new Map();
  let skippedNoIdNumber = 0;
  let duplicateIdNumbers = 0;

  for (const row of uploadedRows) {
    if (!Array.isArray(row)) continue;
    const mapped = mapStudentDetailsRow(row, indexLookup);
    const idNumber = String(mapped.id_number || '').trim().toLowerCase();

    if (!idNumber) {
      skippedNoIdNumber += 1;
      continue;
    }

    if (deduped.has(idNumber)) {
      duplicateIdNumbers += 1;
      continue;
    }

    deduped.set(idNumber, mapped);
  }

  const records = Array.from(deduped.values());

  try {
    const result = await withTransaction(async (client) => {
      let inserted = 0;
      let updated = 0;

      for (const record of records) {
        const upsert = await client.query(
          `
          INSERT INTO student_details_upload (
            id_number, last_name, first_name, gender, year_level, tutor, timetable_class, email_school,
            status, upload_year, upload_term, upload_date, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Current',$9,$10,$11,NOW())
          ON CONFLICT (id_number)
          DO UPDATE SET
            last_name = EXCLUDED.last_name,
            first_name = EXCLUDED.first_name,
            gender = EXCLUDED.gender,
            year_level = EXCLUDED.year_level,
            tutor = EXCLUDED.tutor,
            timetable_class = EXCLUDED.timetable_class,
            email_school = EXCLUDED.email_school,
            status = 'Current',
            upload_year = EXCLUDED.upload_year,
            upload_term = EXCLUDED.upload_term,
            upload_date = EXCLUDED.upload_date,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted;
          `,
          [
            record.id_number || null,
            record.last_name || null,
            record.first_name || null,
            record.gender || null,
            record.year_level || null,
            record.tutor || null,
            record.timetable_class || null,
            record.email_school || null,
            uploadYear,
            uploadTerm,
            uploadDate
          ]
        );

        if (upsert.rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }

      let markedNotCurrent = 0;
      const uploadedIds = records.map((r) => String(r.id_number || '').trim().toLowerCase()).filter(Boolean);
      if (uploadedIds.length > 0) {
        const mark = await client.query(
          `
          UPDATE student_details_upload
          SET status = 'Not Current', updated_at = NOW()
          WHERE status <> 'Not Current'
            AND NOT (lower(id_number) = ANY($1::text[]));
          `,
          [uploadedIds]
        );
        markedNotCurrent = mark.rowCount || 0;
      }

      return { inserted, updated, markedNotCurrent };
    });

    res.json({
      success: true,
      processed: records.length,
      inserted: result.inserted,
      updated: result.updated,
      marked_not_current: result.markedNotCurrent,
      skipped_no_id_number: skippedNoIdNumber,
      duplicate_id_numbers_in_upload: duplicateIdNumbers,
      upload_year: uploadYear,
      upload_term: uploadTerm,
      upload_date: uploadDate
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save student upload data.' });
  }
});

app.get('/api/student_upload/all', async (_req, res) => {
  try {
    const rows = await fetchStudentsWithFallback();
    res.json({ students: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load student timetable data.' });
  }
});

app.post('/api/student_upload/sync-emails', async (req, res) => {
  try {
    const result = await syncStudentEmailsFromStudentUpload();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to sync student emails.' });
  }
});

app.post('/api/student_upload', async (req, res) => {
  const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
  const uploadedRows = Array.isArray(req.body?.students) ? req.body.students : [];

  if (headers.length === 0 || uploadedRows.length === 0) {
    res.status(400).json({ error: 'Missing headers or student rows.' });
    return;
  }

  const uploadYear = Number.isInteger(Number(req.body?.uploadYear)) ? Number(req.body.uploadYear) : null;
  const uploadTerm = String(req.body?.uploadTerm || '').trim() || null;
  const uploadDate = parseUploadDate(req.body?.uploadDate);

  const headerMap = buildStudentHeaderMap(headers);
  const deduped = new Map();
  let skippedNoIdNumber = 0;
  let duplicateIdNumbers = 0;

  for (const row of uploadedRows) {
    if (!Array.isArray(row)) continue;
    const mapped = mapStudentRow(row, headerMap);
    const idNumber = String(mapped.id_number || '').trim().toLowerCase();

    if (!idNumber) {
      skippedNoIdNumber += 1;
      continue;
    }

    if (deduped.has(idNumber)) {
      duplicateIdNumbers += 1;
      continue;
    }

    deduped.set(idNumber, mapped);
  }

  const records = Array.from(deduped.values());

  try {
    const result = await withTransaction(async (client) => {
      let inserted = 0;
      let updated = 0;

      for (const record of records) {
        const values = [
          record.student_name || null,
          record.id_number || null,
          record.form_class || null,
          record.year_level || null,
          ...STUDENT_PERIOD_KEYS.map((key) => record[key] || null),
          uploadYear,
          uploadTerm,
          uploadDate
        ];

        const upsert = await client.query(
          `
          INSERT INTO student_upload (
            student_name, id_number, form_class, year_level,
            mon_p1_1, mon_p1_2, mon_p2, mon_i, mon_p3, mon_p4, mon_l, mon_p5,
            tue_p1_1, tue_p1_2, tue_p2, tue_i, tue_p3, tue_p4, tue_l, tue_p5,
            wed_p1_1, wed_p1_2, wed_p2, wed_i, wed_p3, wed_p4, wed_l, wed_p5,
            thu_p1_1, thu_p1_2, thu_p2, thu_i, thu_p3, thu_p4, thu_l, thu_p5,
            fri_p1_1, fri_p1_2, fri_p2, fri_i, fri_p3, fri_p4, fri_l, fri_p5,
            status, upload_year, upload_term, upload_date, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28,
            $29, $30, $31, $32, $33, $34, $35, $36,
            $37, $38, $39, $40, $41, $42, $43, $44,
            'Current', $45, $46, $47, NOW()
          )
          ON CONFLICT (id_number)
          DO UPDATE SET
            student_name = EXCLUDED.student_name,
            form_class = EXCLUDED.form_class,
            year_level = EXCLUDED.year_level,
            mon_p1_1 = EXCLUDED.mon_p1_1, mon_p1_2 = EXCLUDED.mon_p1_2, mon_p2 = EXCLUDED.mon_p2, mon_i = EXCLUDED.mon_i,
            mon_p3 = EXCLUDED.mon_p3, mon_p4 = EXCLUDED.mon_p4, mon_l = EXCLUDED.mon_l, mon_p5 = EXCLUDED.mon_p5,
            tue_p1_1 = EXCLUDED.tue_p1_1, tue_p1_2 = EXCLUDED.tue_p1_2, tue_p2 = EXCLUDED.tue_p2, tue_i = EXCLUDED.tue_i,
            tue_p3 = EXCLUDED.tue_p3, tue_p4 = EXCLUDED.tue_p4, tue_l = EXCLUDED.tue_l, tue_p5 = EXCLUDED.tue_p5,
            wed_p1_1 = EXCLUDED.wed_p1_1, wed_p1_2 = EXCLUDED.wed_p1_2, wed_p2 = EXCLUDED.wed_p2, wed_i = EXCLUDED.wed_i,
            wed_p3 = EXCLUDED.wed_p3, wed_p4 = EXCLUDED.wed_p4, wed_l = EXCLUDED.wed_l, wed_p5 = EXCLUDED.wed_p5,
            thu_p1_1 = EXCLUDED.thu_p1_1, thu_p1_2 = EXCLUDED.thu_p1_2, thu_p2 = EXCLUDED.thu_p2, thu_i = EXCLUDED.thu_i,
            thu_p3 = EXCLUDED.thu_p3, thu_p4 = EXCLUDED.thu_p4, thu_l = EXCLUDED.thu_l, thu_p5 = EXCLUDED.thu_p5,
            fri_p1_1 = EXCLUDED.fri_p1_1, fri_p1_2 = EXCLUDED.fri_p1_2, fri_p2 = EXCLUDED.fri_p2, fri_i = EXCLUDED.fri_i,
            fri_p3 = EXCLUDED.fri_p3, fri_p4 = EXCLUDED.fri_p4, fri_l = EXCLUDED.fri_l, fri_p5 = EXCLUDED.fri_p5,
            status = 'Current',
            upload_year = EXCLUDED.upload_year,
            upload_term = EXCLUDED.upload_term,
            upload_date = EXCLUDED.upload_date,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted;
          `,
          values
        );

        if (upsert.rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }

      let markedNotCurrent = 0;
      const uploadedIds = records.map((r) => String(r.id_number || '').trim().toLowerCase()).filter(Boolean);
      if (uploadedIds.length > 0) {
        const mark = await client.query(
          `
          UPDATE student_upload
          SET status = 'Not Current', updated_at = NOW()
          WHERE status <> 'Not Current'
            AND NOT (lower(id_number) = ANY($1::text[]));
          `,
          [uploadedIds]
        );
        markedNotCurrent = mark.rowCount || 0;
      }

      return { inserted, updated, markedNotCurrent };
    });

    res.json({
      success: true,
      processed: records.length,
      inserted: result.inserted,
      updated: result.updated,
      marked_not_current: result.markedNotCurrent,
      skipped_no_id_number: skippedNoIdNumber,
      duplicate_id_numbers_in_upload: duplicateIdNumbers,
      upload_year: uploadYear,
      upload_term: uploadTerm,
      upload_date: uploadDate
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save student upload data.' });
  }
});

app.get('/api/timetable/all', async (_req, res) => {
  try {
    const timetable = await fetchTimetableWithFallback();
    res.json({ timetable });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load timetable data.' });
  }
});

app.get('/api/feed/staff/current', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = toPositiveIntOrDefault(req.query.limit, 2000, 10000);

    const params = [];
    let where = "WHERE status = 'Current'";

    if (q) {
      params.push(`%${q}%`);
      where += `\n        AND (
          lower(coalesce(code, '')) LIKE $${params.length}
          OR lower(coalesce(first_name, '')) LIKE $${params.length}
          OR lower(coalesce(last_name, '')) LIKE $${params.length}
          OR lower(coalesce(email_school, '')) LIKE $${params.length}
        )`;
    }

    params.push(limit);

    const { rows } = await pool.query(
      `
      SELECT id, code, last_name, first_name, title, email_school, status, upload_year, upload_term, upload_date
      FROM staff_upload
      ${where}
      ORDER BY last_name ASC, first_name ASC
      LIMIT $${params.length};
      `,
      params
    );

    res.json({
      count: rows.length,
      filters: { q: q || null, limit },
      staff: rows
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load current staff feed.' });
  }
});

app.get('/api/feed/students/current', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const formClass = String(req.query.form_class || '').trim().toLowerCase();
    const yearLevel = String(req.query.year_level || '').trim().toLowerCase();
    const limit = toPositiveIntOrDefault(req.query.limit, 5000, 20000);

    const rows = await fetchStudentsWithFallback();
    const filtered = rows
      .filter((row) => String(row.status || 'Current').toLowerCase() === 'current')
      .filter((row) => {
        if (!formClass) return true;
        return String(row.form_class || '').toLowerCase() === formClass;
      })
      .filter((row) => {
        if (!yearLevel) return true;
        return String(row.year_level || '').toLowerCase() === yearLevel;
      })
      .filter((row) => {
        if (!q) return true;
        return (
          includesText(row.student_name, q) ||
          includesText(row.id_number, q) ||
          includesText(row.form_class, q)
        );
      })
      .slice(0, limit);

    res.json({
      count: filtered.length,
      filters: {
        q: q || null,
        form_class: formClass || null,
        year_level: yearLevel || null,
        limit
      },
      students: filtered
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load current students feed.' });
  }
});

app.get('/api/feed/timetable/by-teacher/:teacherKey', async (req, res) => {
  try {
    const teacherKey = String(req.params.teacherKey || '').trim().toLowerCase();
    if (!teacherKey) {
      res.status(400).json({ error: 'Teacher key is required.' });
      return;
    }

    const rows = await fetchTimetableWithFallback();
    const row = rows.find((item) => String(item.Teacher || item.teacher || '').trim().toLowerCase() === teacherKey);

    if (!row) {
      res.status(404).json({ error: 'Teacher timetable not found.' });
      return;
    }

    res.json({
      teacher: teacherKey,
      timetable: row
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load timetable by teacher.' });
  }
});

app.get('/api/feed/timetable/by-class/:classCode', async (req, res) => {
  try {
    const classCode = String(req.params.classCode || '').trim().toLowerCase();
    if (!classCode) {
      res.status(400).json({ error: 'Class code is required.' });
      return;
    }

    const period = String(req.query.period || '').trim();
    const limit = toPositiveIntOrDefault(req.query.limit, 500, 5000);

    const rows = await fetchTimetableWithFallback();
    const scopedRows = rows.filter((row) => String(row.status || 'Current').toLowerCase() === 'current');
    const matches = [];

    for (const row of scopedRows) {
      const teacher = String(row.Teacher || '').trim();
      const teacherName = String(row.Teacher_Name || '').trim();
      const columns = period ? [period] : getTimetableDataColumns(row);

      for (const column of columns) {
        const value = String(row[column] || '').trim();
        if (!value) continue;
        if (!includesText(value, classCode)) continue;

        matches.push({
          teacher,
          teacher_name: teacherName,
          period: column,
          value,
          upload_year: row.upload_year || null,
          upload_term: row.upload_term || null,
          upload_date: row.upload_date || null
        });

        if (matches.length >= limit) break;
      }

      if (matches.length >= limit) break;
    }

    res.json({
      class_code: classCode,
      period: period || null,
      count: matches.length,
      limit,
      matches
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load timetable by class.' });
  }
});

app.get('/api/feed/timetable/by-period/:periodKey', async (req, res) => {
  try {
    const periodKey = String(req.params.periodKey || '').trim();
    if (!periodKey) {
      res.status(400).json({ error: 'Period key is required.' });
      return;
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = toPositiveIntOrDefault(req.query.limit, 500, 5000);

    const rows = await fetchTimetableWithFallback();
    const matches = rows
      .filter((row) => String(row.status || 'Current').toLowerCase() === 'current')
      .map((row) => ({
        teacher: String(row.Teacher || '').trim(),
        teacher_name: String(row.Teacher_Name || '').trim(),
        period: periodKey,
        value: String(row[periodKey] || '').trim(),
        upload_year: row.upload_year || null,
        upload_term: row.upload_term || null,
        upload_date: row.upload_date || null
      }))
      .filter((item) => item.value)
      .filter((item) => (q ? includesText(item.value, q) || includesText(item.teacher_name, q) || includesText(item.teacher, q) : true))
      .slice(0, limit);

    res.json({
      period: periodKey,
      q: q || null,
      count: matches.length,
      limit,
      matches
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load timetable by period.' });
  }
});

app.get('/api/feed/summary/current-counts', async (_req, res) => {
  try {
    const [staffCounts, studentCounts, timetableCounts, staffLatest, studentLatest, timetableLatest] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'Current') AS current_count,
          COUNT(*) FILTER (WHERE status = 'Not Current') AS not_current_count,
          COUNT(*) AS total_count
        FROM staff_upload;
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'Current') AS current_count,
          COUNT(*) FILTER (WHERE status = 'Not Current') AS not_current_count,
          COUNT(*) AS total_count
        FROM student_upload;
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'Current') AS current_count,
          COUNT(*) FILTER (WHERE status = 'Not Current') AS not_current_count,
          COUNT(*) AS total_count
        FROM timetable_upload;
      `),
      pool.query(`
        SELECT upload_year, upload_term, upload_date, updated_at
        FROM staff_upload
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1;
      `),
      pool.query(`
        SELECT upload_year, upload_term, upload_date, updated_at
        FROM student_upload
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1;
      `),
      pool.query(`
        SELECT upload_year, upload_term, upload_date, updated_at
        FROM timetable_upload
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1;
      `)
    ]);

    const safeCounts = (rows) => {
      const row = rows[0] || {};
      return {
        current: Number(row.current_count || 0),
        not_current: Number(row.not_current_count || 0),
        total: Number(row.total_count || 0)
      };
    };

    const safeLatest = (rows) => {
      const row = rows[0] || null;
      if (!row) return null;
      return {
        upload_year: row.upload_year,
        upload_term: row.upload_term,
        upload_date: row.upload_date,
        updated_at: row.updated_at
      };
    };

    res.json({
      generated_at: new Date().toISOString(),
      staff: {
        counts: safeCounts(staffCounts.rows),
        latest_upload: safeLatest(staffLatest.rows)
      },
      students: {
        counts: safeCounts(studentCounts.rows),
        latest_upload: safeLatest(studentLatest.rows)
      },
      timetable: {
        counts: safeCounts(timetableCounts.rows),
        latest_upload: safeLatest(timetableLatest.rows)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load upload summary counts.' });
  }
});

app.post('/api/upload_timetable', async (req, res) => {
  const headers = Array.isArray(req.body?.headers) ? req.body.headers : [];
  const uploadedRows = Array.isArray(req.body?.timetable) ? req.body.timetable : [];

  if (headers.length === 0 || uploadedRows.length === 0) {
    res.status(400).json({ error: 'Missing headers or timetable rows.' });
    return;
  }

  const uploadYear = Number.isInteger(Number(req.body?.uploadYear)) ? Number(req.body.uploadYear) : null;
  const uploadTerm = String(req.body?.uploadTerm || '').trim() || null;
  const uploadDate = parseUploadDate(req.body?.uploadDate);

  const deduped = new Map();
  let skippedNoTeacher = 0;
  let duplicateTeachers = 0;

  for (const row of uploadedRows) {
    if (!Array.isArray(row)) continue;

    const mapped = mapTimetableRow(headers, row);
    const teacher = getTimetableTeacherKey(mapped).toLowerCase();

    if (!teacher) {
      skippedNoTeacher += 1;
      continue;
    }

    if (deduped.has(teacher)) {
      duplicateTeachers += 1;
      continue;
    }

    deduped.set(teacher, {
      teacher,
      teacherName: getTimetableTeacherName(mapped),
      data: mapped
    });
  }

  const records = Array.from(deduped.values());

  try {
    const result = await withTransaction(async (client) => {
      let inserted = 0;
      let updated = 0;

      for (const record of records) {
        const upsert = await client.query(
          `
          INSERT INTO timetable_upload (
            teacher, teacher_name, data, status, upload_year, upload_term, upload_date, updated_at
          ) VALUES ($1,$2,$3::jsonb,'Current',$4,$5,$6,NOW())
          ON CONFLICT (teacher)
          DO UPDATE SET
            teacher_name = EXCLUDED.teacher_name,
            data = EXCLUDED.data,
            status = 'Current',
            upload_year = EXCLUDED.upload_year,
            upload_term = EXCLUDED.upload_term,
            upload_date = EXCLUDED.upload_date,
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted;
          `,
          [
            record.teacher,
            record.teacherName || null,
            JSON.stringify(record.data),
            uploadYear,
            uploadTerm,
            uploadDate
          ]
        );

        if (upsert.rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }

      let markedNotCurrent = 0;
      const uploadedTeachers = records.map((r) => String(r.teacher || '').trim().toLowerCase()).filter(Boolean);
      if (uploadedTeachers.length > 0) {
        const mark = await client.query(
          `
          UPDATE timetable_upload
          SET status = 'Not Current', updated_at = NOW()
          WHERE status <> 'Not Current'
            AND NOT (lower(teacher) = ANY($1::text[]));
          `,
          [uploadedTeachers]
        );
        markedNotCurrent = mark.rowCount || 0;
      }

      return { inserted, updated, markedNotCurrent };
    });

    res.json({
      success: true,
      processed: records.length,
      inserted: result.inserted,
      updated: result.updated,
      marked_not_current: result.markedNotCurrent,
      skipped_no_teacher: skippedNoTeacher,
      duplicate_teachers_in_upload: duplicateTeachers,
      upload_year: uploadYear,
      upload_term: uploadTerm,
      upload_date: uploadDate
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save timetable upload data.' });
  }
});

app.put('/api/upload_timetable/row/:teacherKey', async (req, res) => {
  const teacherKey = String(req.params.teacherKey || '').trim().toLowerCase();
  const row = req.body?.row;

  if (!teacherKey || !row || typeof row !== 'object') {
    res.status(400).json({ success: false, error: 'Missing teacher key or row payload.' });
    return;
  }

  const normalizedRow = { ...row, Teacher: teacherKey };
  const teacherName = getTimetableTeacherName(normalizedRow) || null;

  try {
    const updated = await pool.query(
      `
      UPDATE timetable_upload
      SET teacher_name = $2,
          data = $3::jsonb,
          updated_at = NOW()
      WHERE lower(teacher) = $1
      RETURNING teacher, teacher_name, data, status, upload_year, upload_term, upload_date;
      `,
      [teacherKey, teacherName, JSON.stringify(normalizedRow)]
    );

    if (updated.rowCount === 0) {
      res.status(404).json({ success: false, error: 'Teacher row not found.' });
      return;
    }

    const saved = updated.rows[0];
    res.json({
      success: true,
      row: {
        ...saved.data,
        Teacher: saved.teacher,
        Teacher_Name: saved.teacher_name || saved.data.Teacher_Name || saved.data.teacher_name || '',
        status: saved.status,
        upload_year: saved.upload_year,
        upload_term: saved.upload_term,
        upload_date: saved.upload_date
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to save teacher row.' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

ensureSchema()
  .then(async () => {
    try {
      const syncResult = await syncStudentEmailsFromStudentUpload();
      console.log(
        `Student email sync: processed=${syncResult.processed}, updated=${syncResult.updated}, not_found=${syncResult.not_found_in_student_upload}, skipped_missing_fields=${syncResult.skipped_missing_fields}`
      );
    } catch (error) {
      console.warn(`Student email sync warning: ${error.message}`);
    }

    app.listen(port, () => {
      console.log(`KamarUploader listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database schema:', error.message);
    process.exit(1);
  });
