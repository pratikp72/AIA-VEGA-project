'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getAccessToken } = require('../utils/vega-graph-auth');
const { ensureDepartmentForUser } = require('../utils/ensure-department-for-user');
const { ensureWorkLocationForUser } = require('../utils/ensure-work-location-for-user');

const USER_UID = 'plugin::users-permissions.user';
const ROLE_UID = 'plugin::users-permissions.role';

// Column indices in the Excel sheet (0-based)
// SR.NO | STATUS | USER ID | NAME | EMPLOYMENT TYPE | EMAIL ID | DOB | AGE | CONTACT NO. | DOJ | EXP WITH VEGA | CONTRACT VALIDITY | JOB AREA | DESIGNATION | HOD | Payroll Office | Work Location | Region | Image
const COL = {
  SR_NO: 0,
  STATUS: 1,
  USER_ID: 2,
  NAME: 3,
  EMPLOYMENT_TYPE: 4,
  EMAIL: 5,
  DOB: 6,
  AGE: 7,
  CONTACT: 8,
  DOJ: 9,
  EXP_WITH_VEGA: 10,
  CONTRACT_VALIDITY: 11,
  JOB_AREA: 12,
  DESIGNATION: 13,
  HOD: 14,
  PAYROLL_OFFICE: 15,
  WORK_LOCATION: 16,
  REGION: 17,
  IMAGE: 18,
};

let isRunning = false;
let isRunningStartedAt = null;
const MAX_RUN_MS = 30 * 60 * 1000;

// ── helpers ──────────────────────────────────────────────────────────────────

function safeString(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

/**
 * Excel stores dates as serial numbers (days since 1900-01-01).
 * Convert to ISO date string, or return fallback.
 */
function excelSerialToIso(value, fallback = '1970-01-01') {
  if (!value && value !== 0) return fallback;
  const asString = String(value).trim();
  if (!asString) return fallback;

  // Already ISO-like
  const isoMatch = asString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Slash format
  const slashMatch = asString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const month = p1 > 12 ? p2 : p1;
    const day = p1 > 12 ? p1 : p2;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Excel serial number
  const serial = Number(asString);
  if (!Number.isNaN(serial) && serial > 1000) {
    // Excel epoch: Dec 30, 1899
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  const parsed = new Date(asString);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return fallback;
}



async function getEmployeeRoleId(strapi) {
  const role =
    (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'employee' }, select: ['id'] })) ||
    (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'authenticated' }, select: ['id'] }));
  if (!role?.id) throw new Error('No suitable role found in users-permissions roles');
  return role.id;
}

async function ensureUniqueUsername(strapi, desired, currentUserId) {
  const base = safeString(desired, 'vega_employee').slice(0, 60);
  if (currentUserId) return base;
  const existing = await strapi.db.query(USER_UID).findOne({ where: { username: base }, select: ['id'] });
  if (!existing) return base;
  return `${base.slice(0, 52)}_${crypto.randomBytes(3).toString('hex')}`;
}

// ── Photo helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a SharePoint sharing URL (the :i:/g/personal/... format) to a
 * Graph API download URL using the /shares/{encodedUrl}/driveItem/content endpoint.
 */
async function resolveSharePointDownloadUrl(sharingUrl, accessToken) {
  // Encode the sharing URL as base64url (no padding) per Graph API docs
  const encoded = Buffer.from(sharingUrl).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const shareToken = `u!${encoded}`;
  const url = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem/content`;
  return { url, headers: { Authorization: `Bearer ${accessToken}` } };
}

async function uploadVegaPhoto(strapi, sharingUrl, username, accessToken) {
  const raw = String(sharingUrl || '').trim();
  if (!raw || !raw.startsWith('http')) return null;

  const { url, headers } = await resolveSharePointDownloadUrl(raw, accessToken);

  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`Photo download failed: HTTP ${response.status} from ${url}`);

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  // If SharePoint returns HTML (redirect to login page), bail out
  if (contentType.includes('text/html')) {
    throw new Error(`Photo download returned HTML (not an image) — SharePoint may require re-auth`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('Photo download returned empty file');

  const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  const ext = extMap[contentType.split(';')[0].trim()] || '.jpg';
  const fileName = `vega_${safeString(username, 'employee')}_${Date.now()}${ext}`;
  const tmpFilePath = path.join(os.tmpdir(), fileName);
  await fs.writeFile(tmpFilePath, bytes);

  try {
    // Strapi v5 upload service expects a file object with these exact fields
    const fileInfo = {
      name: fileName,
      alternativeText: safeString(username, 'employee'),
      caption: '',
      folder: null,
    };
    const fileData = {
      path: tmpFilePath,
      filepath: tmpFilePath,
      name: fileName,
      type: contentType,
      size: bytes.length / 1000, // Strapi expects size in KB
    };
    const uploaded = await strapi.plugin('upload').service('upload').upload({
      data: { fileInfo },
      files: fileData,
    });
    if (!Array.isArray(uploaded) || !uploaded[0]?.id) throw new Error('Upload returned no metadata');
    return uploaded[0].id;
  } finally {
    await fs.unlink(tmpFilePath).catch(() => {});
  }
}

// ── MS Graph fetch ────────────────────────────────────────────────────────────

async function fetchExcelRows(strapi) {
  const driveId = String(process.env.VEGA_ONEDRIVE_DRIVE_ID || '').trim();
  const itemId = String(process.env.VEGA_ONEDRIVE_FILE_ITEM_ID || '').trim();
  const worksheet = String(process.env.VEGA_EXCEL_WORKSHEET_NAME || 'Task & Vega').trim();

  if (!driveId || !itemId) {
    throw new Error('[vega-sync] Missing VEGA_ONEDRIVE_DRIVE_ID or VEGA_ONEDRIVE_FILE_ITEM_ID');
  }

  console.log('[vega-sync] getting access token from stored refresh token...');
  const accessToken = await getAccessToken();
  console.log('[vega-sync] access token obtained ✔');

  const encodedSheet = encodeURIComponent(worksheet);
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodedSheet}/usedRange(valuesOnly=true)?$select=values`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`[vega-sync] Graph API failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const rows = data?.values || [];

  // Skip header row only — sync all statuses
  const filtered = rows.slice(1).filter((row) => {
    return row.some((cell) => String(cell || '').trim() !== '');
  });

  return { rows: filtered, accessToken };
}

// ── main sync ─────────────────────────────────────────────────────────────────

async function syncVegaEmployees(strapi) {
  if (isRunning) {
    const elapsed = Date.now() - (isRunningStartedAt || 0);
    if (elapsed < MAX_RUN_MS) {
      strapi.log.warn('[vega-sync] previous run still active, skipping');
      return;
    }
    strapi.log.warn('[vega-sync] previous run timed out, forcing reset');
  }

  isRunning = true;
  isRunningStartedAt = Date.now();

  const defaultPassword = String(process.env.EMPLOYEE_DEFAULT_PASSWORD || 'Welcome@123');
  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  try {
    const roleId = await getEmployeeRoleId(strapi);
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    strapi.log.info('[vega-sync] fetching Excel data from MS Graph...');
    console.log('\n[vega-sync] ▶ Fetching Vega employee data from OneDrive Excel...');
    const { rows, accessToken } = await fetchExcelRows(strapi);
    strapi.log.info(`[vega-sync] ${rows.length} ACTIVE rows to process`);
    console.log(`[vega-sync] ✔ ${rows.length} ACTIVE employees found in sheet\n`);

    for (const row of rows) {
      try {
        const empId = safeString(row[COL.USER_ID], '');
        const rawEmail = safeString(row[COL.EMAIL], '');
        const email = normalizeEmail(rawEmail);
        const hasEmpId = Boolean(empId && empId !== '-');

        if (!hasEmpId && !email) {
          strapi.log.warn(`[vega-sync] Skipping ${row[COL.USER_ID] || row[COL.NAME] || 'unknown'}: missing both emp_id and email`);
          console.log(`[vega-sync]   SKIPPED  ${String(row[COL.USER_ID] || '').padEnd(8)} | no emp_id/email | ${row[COL.NAME] || 'unknown'}`);
          continue;
        }

        let existing = null;
        if (hasEmpId) {
          existing = await strapi.db.query(USER_UID).findOne({
            where: { emp_id: empId },
            select: ['id', 'username', 'email'],
          });
        }

        // Fallback: match by email when emp_id lookup misses.
        if (!existing && email) {
          existing = await strapi.db.query(USER_UID).findOne({
            where: { email },
            select: ['id', 'username', 'email'],
          });
        }

        const resolvedEmail = email || normalizeEmail(existing?.email);
        // If the only email we have is a fake placeholder, don't preserve it —
        // clear it so the user must log in via emp_id instead.
        const isFakePlaceholder = resolvedEmail && (
          resolvedEmail.endsWith('@vega.internal') || resolvedEmail.endsWith('@aia.internal')
        );
        const finalEmail = isFakePlaceholder ? null : resolvedEmail;

        if (!finalEmail && !hasEmpId) {
          strapi.log.warn(`[vega-sync] Skipping ${row[COL.USER_ID] || row[COL.NAME] || 'unknown'}: no usable email or emp_id`);
          console.log(`[vega-sync]   SKIPPED  ${String(row[COL.USER_ID] || '').padEnd(8)} | no emp_id/email | ${row[COL.NAME] || 'unknown'}`);
          continue;
        }

        const name = safeString(row[COL.NAME], finalEmail ? finalEmail.split('@')[0] : safeString(row[COL.USER_ID], 'vega_employee'));
        const username = await ensureUniqueUsername(strapi, name, existing?.id);

        const statusRaw = String(row[COL.STATUS] || '').trim().toUpperCase();
        const isActive = statusRaw === 'ACTIVE';

        const userData = {
          username,
          email: finalEmail,
          provider: 'local',
          confirmed: true,
          blocked: !isActive,
          role: roleId,
          company: 'Vega',
          emp_id: safeString(row[COL.USER_ID]),
          employment_type: safeString(row[COL.EMPLOYMENT_TYPE]),
          date_of_birth: excelSerialToIso(row[COL.DOB]),
          age: 0,
          contact_no: safeString(row[COL.CONTACT]),
          joining_date: excelSerialToIso(row[COL.DOJ]),
          experience_with_vega: safeString(row[COL.EXP_WITH_VEGA]),
          contract_validity: safeString(row[COL.CONTRACT_VALIDITY]),
          department: safeString(row[COL.JOB_AREA]),
          designation: safeString(row[COL.DESIGNATION]),
          HOD: safeString(row[COL.HOD]),
          payroll_office: safeString(row[COL.PAYROLL_OFFICE]),
          working_location: safeString(row[COL.WORK_LOCATION]),
          region: safeString(row[COL.REGION]),
          active: isActive,
          branch: '-',
          ext: 0,
          description: '',
        };

        // Upload photo if SharePoint URL present and user doesn't already have one
        const sharingUrl = safeString(row[COL.IMAGE], '');
        if (sharingUrl && sharingUrl !== '-' && sharingUrl.startsWith('http')) {
          // Check if user already has a photograph via populate (it's a media relation)
          let hasPhoto = false;
          if (existing) {
            const withPhoto = await strapi.db.query(USER_UID).findOne({
              where: { id: existing.id },
              populate: ['photograph'],
            });
            hasPhoto = Boolean(withPhoto?.photograph?.id);
          }
          if (!hasPhoto) {
            try {
              const photoId = await uploadVegaPhoto(strapi, sharingUrl, name, accessToken);
              if (photoId) {
                userData.photograph = photoId;
                console.log(`[vega-sync]   PHOTO    ${String(row[COL.USER_ID]).padEnd(8)} | uploaded id=${photoId}`);
              }
            } catch (photoErr) {
              strapi.log.warn(`[vega-sync] Photo upload failed for ${name}: ${photoErr?.message}`);
              console.log(`[vega-sync]   PHOTO ⚠  ${String(row[COL.USER_ID]).padEnd(8)} | ${photoErr?.message}`);
              console.log(`[vega-sync]   PHOTO STACK: ${photoErr?.stack?.split('\n').slice(0,3).join(' | ')}`);
            }
          }
        }

        if (existing) {
          await strapi.db.query(USER_UID).update({ where: { id: existing.id }, data: userData });
          updatedCount += 1;
          console.log(`[vega-sync]   UPDATED  ${String(row[COL.USER_ID]).padEnd(8)} | ${isActive ? 'ACTIVE  ' : 'INACTIVE'} | ${name} | ${finalEmail || '(no email)'}`);
        } else {
          await strapi.db.query(USER_UID).create({ data: { ...userData, password: passwordHash } });
          createdCount += 1;
          console.log(`[vega-sync]   CREATED  ${String(row[COL.USER_ID]).padEnd(8)} | ${isActive ? 'ACTIVE  ' : 'INACTIVE'} | ${name} | ${finalEmail || '(no email)'}`);
        }

        try {
          await ensureDepartmentForUser(strapi, userData.department, 'Vega');
        } catch (err) {
          strapi.log.warn(`[vega-sync] ensureDepartmentForUser failed for ${name}: ${err?.message}`);
        }

        try {
          if (userData.working_location && userData.working_location !== '-') {
            await ensureWorkLocationForUser(strapi, userData.working_location, 'Vega');
          }
        } catch (err) {
          strapi.log.warn(`[vega-sync] ensureWorkLocationForUser failed for ${name}: ${err?.message}`);
        }
      } catch (rowErr) {
        errorCount += 1;
        const key = row[COL.EMAIL] || row[COL.NAME] || 'unknown';
        strapi.log.error(`[vega-sync] Failed for ${key}: ${rowErr?.message || rowErr}`);
        console.error(`[vega-sync]   ERROR    ${key}: ${rowErr?.message || rowErr}`);
      }
    }

    strapi.log.info(
      `[vega-sync] ===== SYNC COMPLETE ===== created=${createdCount}, updated=${updatedCount}, errors=${errorCount}`
    );
    console.log(`\n[vega-sync] ✅ SYNC COMPLETE — created=${createdCount}, updated=${updatedCount}, errors=${errorCount}\n`);
  } catch (err) {
    strapi.log.error(`[vega-sync] run failed: ${err?.message || err}`);
    console.error(`\n[vega-sync] ❌ FAILED: ${err?.message || err}\n`);
  } finally {
    isRunning = false;
  }
}

module.exports = { syncVegaEmployees };
