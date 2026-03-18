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

    // If first part is > 12, interpret as DD/MM/YYYY; otherwise MM/DD/YYYY.
    const month = part1 > 12 ? part2 : part1;
    const day = part1 > 12 ? part1 : part2;

    const monthPadded = String(month).padStart(2, '0');
    const dayPadded = String(day).padStart(2, '0');
    return `${year}-${monthPadded}-${dayPadded}`;
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
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
    payload?.data,
    payload?.Data,
    payload?.items,
    payload?.Items,
    payload?.result,
    payload?.Result,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

async function getAuthenticatedRoleId(strapi) {
  const role = await strapi.db.query(ROLE_UID).findOne({
    where: { type: 'authenticated' },
    select: ['id'],
  });

  if (!role?.id) {
    throw new Error('Authenticated role not found in users-permissions roles');
  }

  return role.id;
}

async function ensureUniqueUsername(strapi, desiredUsername, currentUserId) {
  const base = safeString(desiredUsername, 'employee').slice(0, 60);
  let candidate = base;
  let attempt = 0;

  while (attempt < 5) {
    const where = currentUserId
      ? { username: candidate, id: { $ne: currentUserId } }
      : { username: candidate };

    const existing = await strapi.db.query(USER_UID).findOne({
      where,
      select: ['id'],
    });

    if (!existing) return candidate;

    attempt += 1;
    const suffix = String(attempt);
    candidate = `${base.slice(0, Math.max(1, 60 - suffix.length - 1))}_${suffix}`;
  }

  return `${base.slice(0, 48)}_${crypto.randomBytes(4).toString('hex')}`;
}

async function uploadPhotograph(strapi, photoUrl, username) {
  const response = await fetch(photoUrl, {
    method: 'GET',
    headers: { accept: '*/*' },
  });

  if (!response.ok) {
    throw new Error(`Photograph download failed: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    throw new Error('Photograph download returned empty file');
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const parsedUrl = new URL(photoUrl);
  const extFromPath = path.extname(parsedUrl.pathname || '') || '.bin';
  const fileName = `${safeString(username, 'employee')}_${Date.now()}${extFromPath}`;
  const tmpFilePath = path.join(os.tmpdir(), fileName);

  await fs.writeFile(tmpFilePath, bytes);

  try {
    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: {
        fileInfo: {
          name: fileName,
          alternativeText: safeString(username, 'employee'),
        },
      },
      files: {
        path: tmpFilePath,
        name: fileName,
        type: contentType,
        size: bytes.length,
      },
    });

    if (!Array.isArray(uploaded) || !uploaded[0]?.id) {
      throw new Error('Upload service did not return uploaded file metadata');
    }

    return uploaded[0].id;
  } finally {
    await fs.unlink(tmpFilePath).catch(() => {});
  }
}

function buildUserData(record, roleId, usernameOverride) {
  return {
    username: usernameOverride,
    email: normalizeEmail(record.Work_Email),
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
    // Fallback values for fields that can still be marked required in schema.
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
    headers: {
      accept: '*/*',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Employee API failed: HTTP ${response.status}`);
  }

  return response.json();
}

async function syncEmployeesFromHrms(strapi) {
  if (isRunning) {
    strapi.log.warn('[employee-sync] previous run still active, skipping this cycle');
    return;
  }

  isRunning = true;

  const baseUrl = String(process.env.EMPLOYEE_API_BASE_URL || '').trim();
  const apiPath = String(process.env.EMPLOYEE_API_PATH || '').trim();
  const companyId = Number(process.env.EMPLOYEE_API_COMPANY_ID || 1);
  const pageSize = Number(process.env.EMPLOYEE_API_PAGE_SIZE || 100);
  const defaultPassword = String(process.env.EMPLOYEE_DEFAULT_PASSWORD || 'Welcome@123');

  if (!baseUrl || !apiPath) {
    strapi.log.error('[employee-sync] Missing EMPLOYEE_API_BASE_URL or EMPLOYEE_API_PATH env config');
    isRunning = false;
    return;
  }

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  try {
    const roleId = await getAuthenticatedRoleId(strapi);
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    const token = await getEmployeeApiToken(strapi);

    strapi.log.info('[employee-sync] token generated successfully; syncing employees...');

    let pageNumber = 1;
    while (true) {
      const payload = await fetchEmployeePage(baseUrl, apiPath, token, companyId, pageNumber, pageSize);
      const employees = extractEmployeeList(payload);

      if (!employees.length) break;

      for (const record of employees) {
        try {
          const email = normalizeEmail(record?.Work_Email);
          if (!email) {
            errorCount += 1;
            strapi.log.warn('[employee-sync] Skipping employee row without Work_Email');
            continue;
          }

          const existing = await strapi.db.query(USER_UID).findOne({
            where: { email },
            select: ['id', 'username'],
          });

          const preferredUsername = safeString(record?.Emp_Name, email.split('@')[0]);
          const username = await ensureUniqueUsername(strapi, preferredUsername, existing?.id);
          const userData = buildUserData(record, roleId, username);

          const rawPhoto = record?.Photograph;
          const photoUrl = resolvePhotoUrl(rawPhoto, baseUrl);
          if (photoUrl) {
            try {
              userData.photograph = await uploadPhotograph(strapi, photoUrl, username);
            } catch (photoErr) {
              strapi.log.warn(
                `[employee-sync] Photograph upload failed for ${email}: ${photoErr?.message || photoErr}`
              );
            }
          }

          if (existing) {
            await strapi.db.query(USER_UID).update({
              where: { id: existing.id },
              data: userData,
            });
            updatedCount += 1;
          } else {
            await strapi.db.query(USER_UID).create({
              data: {
                ...userData,
                password: passwordHash,
              },
            });
            createdCount += 1;
          }
        } catch (employeeErr) {
          errorCount += 1;
          const key = record?.Work_Email || record?.Emp_Name || 'unknown-employee';
          strapi.log.error(`[employee-sync] Failed for ${key}: ${employeeErr?.message || employeeErr}`);
        }
      }

      if (employees.length < pageSize) break;
      pageNumber += 1;
    }

    strapi.log.info(
      `[employee-sync] completed. created=${createdCount}, updated=${updatedCount}, errors=${errorCount}`
    );
  } catch (err) {
    strapi.log.error(`[employee-sync] run failed: ${err?.message || err}`);
  } finally {
    isRunning = false;
  }
}

module.exports = {
  syncEmployeesFromHrms,
};
