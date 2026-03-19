'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getEmployeeApiToken } = require('./get-employee-api-token');

const USER_UID = 'plugin::users-permissions.user';
const ROLE_UID = 'plugin::users-permissions.role';

let isRunning = false;
let isRunningStartedAt = null;
const MAX_RUN_MS = 30 * 60 * 1000;

function safeString(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function normalizeDate(value, fallback = '1970-01-01') {
  if (!value) return fallback;
  const asString = String(value).trim();
  if (!asString) return fallback;

  const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = asString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const part1 = Number(slashMatch[1]);
    const part2 = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const month = part1 > 12 ? part2 : part1;
    const day = part1 > 12 ? part1 : part2;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}

function generateFallbackEmail(record) {
  const mobile = String(record?.Mobile_No || '').trim().replace(/\D/g, '');
  if (mobile) return `emp.${mobile}@aia.internal`;

  const namePart = String(record?.Emp_Name || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 40);
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `emp.${namePart || 'unknown'}.${rand}@aia.internal`;
}

function resolvePhotoUrl(rawPhotoUrl, baseUrl) {
  if (!rawPhotoUrl) return null;
  const photo = String(rawPhotoUrl).trim();
  if (!photo) return null;
  try {
    return new URL(photo).toString();
  } catch {
    try {
      return new URL(photo, baseUrl).toString();
    } catch {
      return null;
    }
  }
}

function extractEmployeeList(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.data?.data,
    payload?.data?.Data,
    payload?.data,
    payload?.Data?.data,
    payload?.Data,
    payload?.items,
    payload?.Items,
    payload?.result?.data,
    payload?.result,
    payload?.Result,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractTotalPages(payload) {
  return (
    payload?.data?.totalPages ??
    payload?.data?.TotalPages ??
    payload?.totalPages ??
    null
  );
}

async function getEmployeeRoleId(strapi) {
  const role =
    (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'employee' }, select: ['id'] })) ||
    (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'authenticated' }, select: ['id'] }));
  if (!role?.id) throw new Error('No suitable role found in users-permissions roles');
  return role.id;
}

async function ensureUniqueUsername(strapi, desiredUsername, currentUserId) {
  const base = safeString(desiredUsername, 'employee').slice(0, 60);
  // If updating existing user, just return the base — no need to check uniqueness
  if (currentUserId) return base;

  // For new users, do a single check only
  const existing = await strapi.db.query(USER_UID).findOne({
    where: { username: base },
    select: ['id'],
  });
  if (!existing) return base;

  // Collision — append random suffix once
  return `${base.slice(0, 52)}_${crypto.randomBytes(3).toString('hex')}`;
}

async function uploadPhotograph(strapi, photoUrl, username) {
  const response = await fetch(photoUrl, { method: 'GET', headers: { accept: '*/*' } });
  if (!response.ok) throw new Error(`Photograph download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('Photograph download returned empty file');

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const parsedUrl = new URL(photoUrl);
  const extFromPath = path.extname(parsedUrl.pathname || '') || '.bin';
  const fileName = `${safeString(username, 'employee')}_${Date.now()}${extFromPath}`;
  const tmpFilePath = path.join(os.tmpdir(), fileName);
  await fs.writeFile(tmpFilePath, bytes);

  try {
    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo: { name: fileName, alternativeText: safeString(username, 'employee') } },
      files: { path: tmpFilePath, name: fileName, type: contentType, size: bytes.length },
    });
    if (!Array.isArray(uploaded) || !uploaded[0]?.id) throw new Error('Upload service returned no metadata');
    return uploaded[0].id;
  } finally {
    await fs.unlink(tmpFilePath).catch(() => {});
  }
}

function buildUserData(record, roleId, usernameOverride, emailOverride) {
  return {
    username: usernameOverride,
    email: emailOverride,
    provider: 'local',
    confirmed: true,
    blocked: false,
    role: roleId,
    joining_date: normalizeDate(record.Date_Of_Joining),
    date_of_birth: normalizeDate(record.Date_Of_Birth),
    contact_no: safeString(record.Mobile_No),
    company: 'AIA',
    branch: safeString(record.Branch),
    exit_date: record.Exit_Date ? normalizeDate(record.Exit_Date, null) : null,
    designation: safeString(record.Designation),
    department: safeString(record.Department),
    emp_code: '-',
    ext: 0,
    age: 0,
    working_location: '-',
    employment_type: '-',
    active: true,
    emp_id: safeString(record.Emp_ID),
    HOD: '-',
    payroll_office: '-',
    region: '-',
    experience_with_vega: '-',
    contract_validity: '-',
    description: '',
  };
}

async function fetchEmployeePage(baseUrl, apiPath, token, companyId, pageNumber, pageSize) {
  const url = new URL(apiPath, baseUrl);
  url.searchParams.set('cmpId', String(companyId));
  url.searchParams.set('empId', '0');
  url.searchParams.set('pageNumber', String(pageNumber));
  url.searchParams.set('pageSize', String(pageSize));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { accept: '*/*', Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Employee API failed: HTTP ${response.status}`);
  return response.json();
}

async function syncEmployeesFromHrms(strapi) {
  if (isRunning) {
    const elapsed = Date.now() - (isRunningStartedAt || 0);
    if (elapsed < MAX_RUN_MS) {
      strapi.log.warn('[employee-sync] previous run still active, skipping this cycle');
      return;
    }
    strapi.log.warn('[employee-sync] previous run timed out, forcing reset');
  }

  isRunning = true;
  isRunningStartedAt = Date.now();

  const baseUrl = String(process.env.EMPLOYEE_API_BASE_URL || '').trim();
  const apiPath = String(process.env.EMPLOYEE_API_PATH || '').trim();
  const companyId = Number(process.env.EMPLOYEE_API_COMPANY_ID || 1);
  const pageSize = Number(process.env.EMPLOYEE_API_PAGE_SIZE || 100);
  const defaultPassword = String(process.env.EMPLOYEE_DEFAULT_PASSWORD || 'Welcome@123');

  if (!baseUrl || !apiPath) {
    strapi.log.error('[employee-sync] Missing EMPLOYEE_API_BASE_URL or EMPLOYEE_API_PATH');
    isRunning = false;
    return;
  }

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  try {
    const roleId = await getEmployeeRoleId(strapi);
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    const token = await getEmployeeApiToken(strapi);

    strapi.log.info('[employee-sync] token generated; syncing employees...');

    let pageNumber = 1;
    let totalPages = null;

    while (true) {
      const payload = await fetchEmployeePage(baseUrl, apiPath, token, companyId, pageNumber, pageSize);

      if (totalPages === null) {
        totalPages = extractTotalPages(payload);
        strapi.log.info(`[employee-sync] totalPages=${totalPages ?? 'unknown'}`);
      }

      const employees = extractEmployeeList(payload);
      strapi.log.info(`[employee-sync] page ${pageNumber}: fetched ${employees.length} employees`);

      if (!employees.length) break;

      for (const record of employees) {
        try {
          const email = normalizeEmail(record?.Work_Email) || generateFallbackEmail(record);

          const existing = await strapi.db.query(USER_UID).findOne({
            where: { email },
            select: ['id', 'username'],
          });

          const preferredUsername = safeString(record?.Emp_Name, email.split('@')[0]);
          const username = await ensureUniqueUsername(strapi, preferredUsername, existing?.id);
          const userData = buildUserData(record, roleId, username, email);

          const photoUrl = resolvePhotoUrl(record?.Photograph, baseUrl);
          if (photoUrl) {
            try {
              userData.photograph = await uploadPhotograph(strapi, photoUrl, username);
            } catch (photoErr) {
              strapi.log.warn(`[employee-sync] Photo upload failed for ${email}: ${photoErr?.message}`);
            }
          }

          if (existing) {
            await strapi.db.query(USER_UID).update({ where: { id: existing.id }, data: userData });
            updatedCount += 1;
          } else {
            await strapi.db.query(USER_UID).create({ data: { ...userData, password: passwordHash } });
            createdCount += 1;
          }
        } catch (employeeErr) {
          errorCount += 1;
          const key = record?.Work_Email || record?.Emp_Name || 'unknown';
          strapi.log.error(`[employee-sync] Failed for ${key}: ${employeeErr?.message || employeeErr}`);
        }
      }

      if (totalPages !== null ? pageNumber >= totalPages : employees.length < pageSize) break;
      pageNumber += 1;
    }

    strapi.log.info(`[employee-sync] done. created=${createdCount}, updated=${updatedCount}, errors=${errorCount}`);
  } catch (err) {
    strapi.log.error(`[employee-sync] run failed: ${err?.message || err}`);
  } finally {
    isRunning = false;
  }
}

module.exports = { syncEmployeesFromHrms };
