// @ts-nocheck
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const USER_UID = 'plugin::users-permissions.user';

let isRunning = false;
let isRunningStartedAt = null;
const MAX_RUN_MS = 30 * 60 * 1000;

/**
 * Reads /mnt/empimages and builds a map: empCode -> fileName (most recent file wins).
 *
 * Filename format: <empCode>_<date>_<time>_<id>.<ext>
 * e.g. 11000_06_06_2018_16_19_38_00002638.JPG
 */
async function buildEmpCodeToFileMap(imagesDir, strapi) {
  const map = new Map(); // empCode -> { fileName, mtime }

  let entries;
  try {
    entries = await fs.readdir(imagesDir, { withFileTypes: true });
  } catch (err) {
    strapi.log.error(`[aia-photo-sync] Cannot read "${imagesDir}": ${err.message}`);
    return map;
  }

  const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;

    // Filename format: <photoId>_<date>_<time>_<empCode>.<ext>
    // e.g. 11788_27_09_2021_16_19_09_00008918.png
    // The emp_code is the LAST underscore-separated segment before the extension.
    const nameWithoutExt = entry.name.slice(0, entry.name.length - ext.length);
    const lastUnderscoreIdx = nameWithoutExt.lastIndexOf('_');
    if (lastUnderscoreIdx === -1) continue;

    const empCode = nameWithoutExt.slice(lastUnderscoreIdx + 1).trim();
    if (!empCode) continue;

    try {
      const stat = await fs.stat(path.join(imagesDir, entry.name));
      const existing = map.get(empCode);
      if (!existing || stat.mtimeMs > existing.mtime) {
        map.set(empCode, { fileName: entry.name, mtime: stat.mtimeMs });
      }
    } catch {
      if (!map.has(empCode)) {
        map.set(empCode, { fileName: entry.name, mtime: 0 });
      }
    }
  }

  return map;
}

/**
 * Syncs AIA employee photos by storing just the filename on the user record.
 * Images are served directly from the mounted folder via /empimages/:filename.
 *
 * No file copying. No Strapi media uploads. Just a lightweight DB string update.
 * When the folder gets a new/updated photo, the next cron run picks it up automatically.
 */
async function syncAiaEmployeePhotos(strapi) {
  if (isRunning) {
    const elapsed = Date.now() - (isRunningStartedAt || 0);
    if (elapsed < MAX_RUN_MS) {
      strapi.log.warn('[aia-photo-sync] previous run still active, skipping');
      return;
    }
    strapi.log.warn('[aia-photo-sync] previous run timed out, forcing reset');
  }

  isRunning = true;
  isRunningStartedAt = Date.now();

  const imagesDir = String(process.env.AIA_EMP_IMAGES_DIR || '/mnt/empimages').trim();
  strapi.log.info(`[aia-photo-sync] Starting sync from "${imagesDir}"`);
  console.log(`\n[aia-photo-sync] ▶ Starting photo sync from "${imagesDir}"...`);

  let updatedCount = 0;
  let skippedUnchanged = 0;
  let skippedNoImage = 0;
  let errorCount = 0;

  try {
    const empCodeMap = await buildEmpCodeToFileMap(imagesDir, strapi);
    strapi.log.info(`[aia-photo-sync] ${empCodeMap.size} unique employee images found`);
    console.log(`[aia-photo-sync] ✔ ${empCodeMap.size} unique employee images found in "${imagesDir}"`);

    if (empCodeMap.size === 0) {
      strapi.log.warn('[aia-photo-sync] No images found, aborting');
      console.log('[aia-photo-sync] ⚠ No images found — check AIA_EMP_IMAGES_DIR and that the folder is mounted');
      return;
    }

    const batchSize = 200;
    let offset = 0;
    let totalProcessed = 0;

    while (true) {
      const users = await strapi.db.query(USER_UID).findMany({
        where: { company: 'AIA' },
        select: ['id', 'emp_code', 'emp_photo_file'],
        limit: batchSize,
        offset,
        orderBy: { id: 'asc' },
      });

      if (!Array.isArray(users) || users.length === 0) break;
      totalProcessed += users.length;

      for (const user of users) {
        try {
          const empCode = String(user.emp_code || '').trim();
          if (!empCode || empCode === '-') { skippedNoImage++; continue; }

          // emp_code in DB matches the last segment of the filename directly (e.g. "00008918")
          const imageEntry = empCodeMap.get(empCode);
          if (!imageEntry) { skippedNoImage++; continue; }

          // Only update if the filename has changed (new photo dropped in folder)
          if (user.emp_photo_file === imageEntry.fileName) {
            skippedUnchanged++;
            continue;
          }

          await strapi.db.query(USER_UID).update({
            where: { id: user.id },
            data: { emp_photo_file: imageEntry.fileName },
          });

          updatedCount++;
          strapi.log.info(`[aia-photo-sync] emp_code=${empCode} -> ${imageEntry.fileName}`);
        } catch (err) {
          errorCount++;
          strapi.log.error(`[aia-photo-sync] Failed for emp_code=${user.emp_code}: ${err?.message}`);
        }
      }

      if (users.length < batchSize) break;
      offset += users.length;
    }

    strapi.log.info(
      `[aia-photo-sync] DONE — total=${totalProcessed}, updated=${updatedCount}, unchanged=${skippedUnchanged}, noImage=${skippedNoImage}, errors=${errorCount}`
    );
    console.log(`[aia-photo-sync] ✅ DONE — total=${totalProcessed}, updated=${updatedCount}, unchanged=${skippedUnchanged}, noImage=${skippedNoImage}, errors=${errorCount}\n`);
  } catch (err) {
    strapi.log.error(`[aia-photo-sync] run failed: ${err?.message}`);
  } finally {
    isRunning = false;
  }
}

module.exports = { syncAiaEmployeePhotos };
