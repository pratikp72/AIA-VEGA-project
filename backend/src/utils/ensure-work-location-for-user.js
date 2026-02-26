'use strict';

const COMPANY_UID = 'api::company.company';
const WORK_LOCATION_UID = 'api::work-location.work-location';

/**
 * Ensure a Work Location document exists for the given location name and company name (AIA/Vega).
 * One work location entry per (name, company). Creates only if not found.
 */
async function ensureWorkLocationForUser(strapi, locationName, companyName) {
  if (!locationName || !companyName) return;

  const company = await strapi.documents(COMPANY_UID).findFirst({
    filters: { name: { $eq: companyName } },
  });
  if (!company) {
    strapi.log.warn(`ensureWorkLocationForUser: no Company found with name "${companyName}". Create a Company with name AIA or Vega.`);
    return;
  }

  const locName = String(locationName).trim();
  const existing = await strapi.documents(WORK_LOCATION_UID).findFirst({
    filters: {
      name: { $eq: locName },
      company: { documentId: { $eq: company.documentId } },
    },
  });
  if (existing) return;

  await strapi.documents(WORK_LOCATION_UID).create({
    data: {
      name: locName,
      company: { connect: [{ documentId: company.documentId }] },
    },
    status: 'published',
  });
}

module.exports = { ensureWorkLocationForUser };
