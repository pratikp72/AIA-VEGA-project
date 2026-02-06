'use strict';

const COMPANY_UID = 'api::company.company';
const DEPARTMENT_UID = 'api::department.department';

/**
 * Ensure a Department document exists for the given department name and company name (AIA/Vega).
 * One department entry per (name, company). Creates only if not found.
 */
async function ensureDepartmentForUser(strapi, departmentName, companyName) {
  if (!departmentName || !companyName) return;

  const company = await strapi.documents(COMPANY_UID).findFirst({
    filters: { name: { $eq: companyName } },
  });
  if (!company) {
    strapi.log.warn(`ensureDepartmentForUser: no Company found with name "${companyName}". Create a Company with name AIA or Vega.`);
    return;
  }

  const deptName = String(departmentName).trim();
  const existing = await strapi.documents(DEPARTMENT_UID).findFirst({
    filters: {
      name: { $eq: deptName },
      company: { documentId: { $eq: company.documentId } },
    },
  });
  if (existing) return;

  await strapi.documents(DEPARTMENT_UID).create({
    data: {
      name: deptName,
      company: { connect: [{ documentId: company.documentId }] },
    },
    status: 'published',
  });
}

module.exports = { ensureDepartmentForUser };
