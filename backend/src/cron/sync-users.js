'use strict';

/**
 * sync-users.js
 *
 * Cron task: Fetch users from external HR API and upsert them into the up_users table.
 *
 * Flow:
 *   1. POST to SYNC_API_TOKEN_URL to obtain a bearer token.
 *   2. GET SYNC_API_USERS_URL using that token to retrieve employee records.
 *   3. For each record, create or update the corresponding user in up_users.
 *
 * Environment variables (see .env.example):
 *   SYNC_API_TOKEN_URL       – endpoint to fetch the auth token
 *   SYNC_API_TOKEN_USERNAME  – username / client credential for the token request
 *   SYNC_API_TOKEN_PASSWORD  – password / client credential for the token request
 *   SYNC_API_USERS_URL       – endpoint that returns the employee list
 *   SYNC_API_COMPANY         – company value to assign (AIA | Vega), default "AIA"
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Minimal HTTP/HTTPS request helper (no external dependencies).
 * Returns the parsed JSON body or throws on non-2xx status.
 */
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) {
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = lib.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── token fetch ─────────────────────────────────────────────────────────────

/**
 * Obtain a bearer token from the external token API.
 * Expects a JSON response that contains the token in one of:
 *   { token }  |  { access_token }  |  { data.token }
 */
async function fetchToken(strapi) {
  const tokenUrl = process.env.SYNC_API_TOKEN_URL;
  const username = process.env.SYNC_API_TOKEN_USERNAME;
  const password = process.env.SYNC_API_TOKEN_PASSWORD;

  if (!tokenUrl) {
    strapi.log.warn('[sync-users] SYNC_API_TOKEN_URL is not set – skipping token fetch');
    return null;
  }

  const payload = {};
  if (username) payload.username = username;
  if (password) payload.password = password;

  const data = await request(tokenUrl, { method: 'POST' }, payload);

  const token =
    data?.token ||
    data?.access_token ||
    data?.data?.token ||
    data?.data?.access_token;

  if (!token) {
    throw new Error(`Token API response did not contain a token: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return token;
}

// ─── field mapping ───────────────────────────────────────────────────────────

/**
 * Map a raw employee record from the external API to the up_users schema.
 *
 * Rules:
 *  - Use the value from the API when available.
 *  - For fields not present in the API response:
 *      • string required  → "-"
 *      • integer required → 0
 *      • boolean          → default value
 *      • date             → null (omitted)
 *
 * Update this mapping to match the actual field names returned by your HR API.
 */
function mapEmployeeToUser(emp, defaultCompany) {
  // ── helpers ──
  const str = (v) => (v != null && String(v).trim() !== '' ? String(v).trim() : null);
  const int = (v) => (v != null && !isNaN(Number(v)) ? Number(v) : null);
  const date = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  };
  const company = (v) => {
    const s = str(v) || defaultCompany || 'AIA';
    const upper = s.toUpperCase();
    if (upper === 'AIA') return 'AIA';
    if (upper === 'VEGA') return 'Vega';
    return s; // pass through; Strapi will validate
  };

  // ── primary identifiers ──
  const email =
    str(emp.email) ||
    str(emp.work_email) ||
    str(emp.official_email);

  const employeeName =
    str(emp.employee_name) ||
    str(emp.full_name) ||
    str(emp.name) ||
    str(emp.emp_name);

  const empCode =
    str(emp.emp_code) ||
    str(emp.employee_code) ||
    str(emp.code);

  const empId =
    str(emp.emp_id) ||
    str(emp.employee_id) ||
    str(emp.id);

  // ── username: use email prefix if no dedicated field ──
  const username =
    str(emp.username) ||
    str(emp.user_name) ||
    (email ? email.split('@')[0] : null) ||
    empCode ||
    empId;

  // ── other fields ──
  const joiningDate  = date(emp.joining_date  || emp.date_of_joining || emp.start_date);
  const dateOfBirth  = date(emp.date_of_birth || emp.dob || emp.birth_date);
  const exitDate     = date(emp.exit_date     || emp.leaving_date);
  const contactNo    = str(emp.contact_no || emp.phone || emp.mobile);
  const companyVal   = company(emp.company || emp.company_name);
  const branch       = str(emp.branch || emp.branch_name);
  const workingLoc   = str(emp.working_location || emp.work_location || emp.location);
  const empType      = str(emp.employment_type  || emp.emp_type || emp.contract_type);
  const designation  = str(emp.designation      || emp.job_title || emp.position);
  const department   = str(emp.department       || emp.department_name || emp.dept);
  const description  = str(emp.description      || emp.notes || emp.remarks);
  const ageVal       = int(emp.age);
  const extVal       = int(emp.ext || emp.extension);
  const activeVal    =
    emp.active != null ? Boolean(emp.active) :
    emp.status != null ? String(emp.status).toLowerCase() !== 'inactive' :
    true;

  return {
    // ── required fields – use "-" / 0 when the API doesn't supply them ──
    username:         username          || '-',
    email:            email             || '',   // empty string → will be caught by validation
    employee_name:    employeeName      || '-',
    joining_date:     joiningDate       || null,
    date_of_birth:    dateOfBirth       || null,
    contact_no:       contactNo         || '-',
    company:          companyVal,
    branch:           branch            || '-',
    working_location: workingLoc        || '-',
    employment_type:  empType           || '-',
    designation:      designation       || '-',
    department:       department        || '-',
    emp_code:         empCode           || '-',
    emp_id:           empId             || '-',
    age:              ageVal            ?? 0,
    ext:              extVal            ?? 0,

    // ── optional fields ──
    active:           activeVal,
    exit_date:        exitDate          || undefined,
    description:      description       || undefined,

    // ── auth defaults ──
    confirmed:        true,
    blocked:          false,
    provider:         'local',
  };
}

// ─── upsert logic ─────────────────────────────────────────────────────────────

/**
 * Create or update a user in up_users.
 * Matching is done by email (primary) or username (fallback).
 */
async function upsertUser(strapi, userData) {
  const USER_UID = 'plugin::users-permissions.user';

  if (!userData.email) {
    strapi.log.warn(`[sync-users] Skipping record with no email: ${JSON.stringify(userData).slice(0, 100)}`);
    return { skipped: true };
  }

  // Find existing user by email (primary) or username (fallback)
  let existing = await strapi.db.query(USER_UID).findOne({
    where: { email: userData.email },
  });

  if (!existing) {
    existing = await strapi.db.query(USER_UID).findOne({
      where: { username: userData.username },
    });
  }

  if (existing) {
    // Update existing user (do not overwrite password or photograph)
    const { password: _password, photograph: _photograph, ...updateData } = userData;
    await strapi.db.query(USER_UID).update({
      where: { id: existing.id },
      data: updateData,
    });
    return { updated: true, id: existing.id };
  }

  // Create new user – generate a cryptographically secure random password.
  // Users must reset their password via the forgot-password flow on first login.
  const { randomBytes } = require('crypto');
  const tempPassword = randomBytes(16).toString('hex');

  // Hash the password using Strapi's auth service
  let hashedPassword;
  try {
    const authService = strapi.plugin('users-permissions')?.service('auth');
    if (authService?.hashPassword) {
      hashedPassword = await authService.hashPassword(tempPassword);
    } else {
      // Fallback: bcryptjs (bundled with Strapi)
      const bcrypt = require('bcryptjs');
      hashedPassword = await bcrypt.hash(tempPassword, 10);
    }
  } catch (err) {
    // Do not store plaintext passwords – fail the record instead
    throw new Error(`Could not hash password for ${userData.email}: ${err?.message}`);
  }

  // Get the default authenticated role
  let roleId;
  try {
    const role = await strapi.db
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });
    roleId = role?.id;
  } catch {
    // leave undefined
  }

  const newUser = {
    ...userData,
    password: hashedPassword,
    ...(roleId ? { role: roleId } : {}),
  };

  const created = await strapi.db.query(USER_UID).create({ data: newUser });
  return { created: true, id: created.id };
}

// ─── main sync task ───────────────────────────────────────────────────────────

/**
 * Main entry point – called by the cron scheduler.
 */
async function syncUsers(strapi) {
  const usersUrl = process.env.SYNC_API_USERS_URL;
  const defaultCompany = process.env.SYNC_API_COMPANY || 'AIA';

  if (!usersUrl) {
    strapi.log.warn('[sync-users] SYNC_API_USERS_URL is not set – cron task skipped');
    return;
  }

  strapi.log.info('[sync-users] Starting user sync…');

  // 1. Fetch token
  let token = null;
  try {
    token = await fetchToken(strapi);
  } catch (err) {
    strapi.log.error('[sync-users] Failed to fetch token:', err?.message || err);
    return;
  }

  // 2. Fetch employee list
  let employees;
  try {
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await request(usersUrl, { method: 'GET', headers });

    // API may return { data: [...] } or a plain array
    employees = Array.isArray(response)
      ? response
      : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.employees)
          ? response.employees
          : Array.isArray(response?.records)
            ? response.records
            : [];

    strapi.log.info(`[sync-users] Fetched ${employees.length} employee record(s) from API`);
  } catch (err) {
    strapi.log.error('[sync-users] Failed to fetch employees from API:', err?.message || err);
    return;
  }

  // 3. Upsert each employee
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const emp of employees) {
    try {
      const userData = mapEmployeeToUser(emp, defaultCompany);
      const result = await upsertUser(strapi, userData);
      if (result.created) created++;
      else if (result.updated) updated++;
      else skipped++;
    } catch (err) {
      strapi.log.error('[sync-users] Failed to upsert employee:', err?.message || err);
      skipped++;
    }
  }

  strapi.log.info(
    `[sync-users] Sync complete – created: ${created}, updated: ${updated}, skipped: ${skipped}`
  );
}

module.exports = { syncUsers };
