import React from 'react';
import { Box, Flex, Typography, SingleSelect, SingleSelectOption } from '@strapi/design-system';

export function Filters({
  viewMode,
  onViewModeChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  department,
  onDepartmentChange,
  departments = [],
  company,
  onCompanyChange,
  showEmployeeSelector,
  children,
  // Unit Location (Overall dashboard only)
  showUnitLocation = false,
  unitLocation = '',
  onUnitLocationChange = null,
  unitLocations = [],
  // Employee Table (Learning dashboard only)
  showEmployeeTable = false,
  // Activity Tracking (Overall dashboard only)
  showActivityTracking = false,
  activityType = '',
  onActivityTypeChange = null,
  search,
  onSearchChange,
}) {
  const activityTypeOptions = [
    { value: '', label: 'All Activities' },
    { value: 'News_Reading', label: 'News Reading' },
    { value: 'Event_Info', label: 'Event Info' },
    { value: 'Townhall_Video', label: 'Townhall (Video)' },
    { value: 'Townhall_PDF', label: 'Townhall PDF View' },
    { value: 'Holiday_View', label: 'Holiday View' },
  ];
  const companies = [
    { value: '', label: 'All Companies' },
    { value: 'AIA', label: 'AIA' },
    { value: 'Vega', label: 'Vega' },
  ];

  return (
    <Box
      padding={4}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor="neutral200"
      borderWidth="1px"
      borderStyle="solid"
      marginBottom={4}
    >
      <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
        Filters
      </Typography>
      <Flex gap={4} wrap="wrap" alignItems="end">
        <Box style={{ minWidth: 140 }}>
          <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
            View
          </Typography>
          <SingleSelect value={viewMode} onChange={onViewModeChange}>
            {showActivityTracking && (
              <SingleSelectOption value="activityTracking">Activity Tracking</SingleSelectOption>
            )}
            <SingleSelectOption value="personal">Personal</SingleSelectOption>
            <SingleSelectOption value="global">Content</SingleSelectOption>
            {showEmployeeTable && (
              <SingleSelectOption value="table">Employee Table</SingleSelectOption>
            )}
          </SingleSelect>
        </Box>
        {showEmployeeSelector && viewMode === 'personal' && children}
        {viewMode === 'table' && (
          <Box style={{ minWidth: 200 }}>
            <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
              Search Employee (ID or name)
            </Typography>
            <input
              type="text"
              value={search || ''}
              onChange={(e) => onSearchChange?.(e.target.value || '')}
              placeholder="ID, name, or email"
              style={{
                padding: '8px 12px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '14px',
                minWidth: '100%',
              }}
            />
          </Box>
        )}
        {(
          <>
            <Box>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Date From
              </Typography>
              <input
                type="date"
                value={dateFrom || ''}
                onChange={(e) => onDateFromChange(e.target.value || null)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
            </Box>
            <Box>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Date To
              </Typography>
              <input
                type="date"
                value={dateTo || ''}
                onChange={(e) => onDateToChange(e.target.value || null)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
            </Box>
          </>
        )}
        {viewMode !== 'personal' && viewMode !== 'table' && departments.length > 0 && (
          <Box style={{ minWidth: 180 }}>
            <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
              Department
            </Typography>
            <select
              value={department || ''}
              onChange={(e) => onDepartmentChange(e.target.value || '')}
              style={{
                padding: '8px 12px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '14px',
                minWidth: '100%',
              }}
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
            </select>
          </Box>
        )}
        <Box style={{ minWidth: 140 }}>
          <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
            Company
          </Typography>
          <select
            value={company || ''}
            onChange={(e) => onCompanyChange(e.target.value || '')}
            style={{
              padding: '8px 12px',
              border: '1px solid #dcdce4',
              borderRadius: '4px',
              fontSize: '14px',
              minWidth: '100%',
            }}
          >
            {companies.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Box>
        {showActivityTracking && viewMode === 'activityTracking' && (
          <Box style={{ minWidth: 180 }}>
            <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
              Activity Type
            </Typography>
            <select
              value={activityType || ''}
              onChange={(e) => onActivityTypeChange?.(e.target.value || '')}
              style={{
                padding: '8px 12px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '14px',
                minWidth: '100%',
              }}
            >
              {activityTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Box>
        )}
        {showUnitLocation && viewMode !== 'personal' && (
          <Box style={{ minWidth: 180 }}>
            <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
              Unit Location
            </Typography>
            <select
              value={unitLocation || ''}
              onChange={(e) => onUnitLocationChange?.(e.target.value || '')}
              style={{
                padding: '8px 12px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '14px',
                minWidth: '100%',
              }}
            >
              <option value="">All Unit Locations</option>
              {unitLocations.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name}
                </option>
              ))}
            </select>
          </Box>
        )}
      </Flex>
    </Box>
  );
}
