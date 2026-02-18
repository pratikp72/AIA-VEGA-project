import React, { useCallback } from 'react';
import { Box, Flex, Typography, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import DateRangeInput from './DateRangeInput';

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
  showUnitLocation = false,
  unitLocation = '',
  onUnitLocationChange = null,
  unitLocations = [],
  showEmployeeTable = false,
  showActivityTracking = false,
  activityType = '',
  onActivityTypeChange = null,
  search,
  onSearchChange,
  filterCourse,
  setFilterCourse,
  filterStatus,
  setFilterStatus,
  filterTimeMin,
  setFilterTimeMin,
  filterTimeMax,
  setFilterTimeMax,
  courses = [],
}) {
  const activityTypeOptions = [
    { value: '', label: 'All Pages' },
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
        {/* 1. Company */}
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
        {/* 2. View */}
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
          <>
            {/* 3. Search Employee */}
            <Box style={{ minWidth: 200 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Search Employee
              </Typography>
              <input
                type="text"
                value={search || ''}
                onChange={(e) => onSearchChange?.(e.target.value || '')}
                placeholder="name"
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              />
            </Box>
            {/* 4. Course Filter */}
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course
              </Typography>
              <select
                value={filterCourse || ''}
                onChange={e => setFilterCourse(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              >
                <option value="">All Courses</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </Box>
            {/* 5. Course by Status */}
            <Box style={{ minWidth: 160 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course Status
              </Typography>
              <select
                value={filterStatus || ''}
                onChange={e => setFilterStatus(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minWidth: '100%',
                }}
              >
                <option value="">All Statuses</option>
                <option value="Not_started">Not Started</option>
                <option value="In_progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="Failed">Failed</option>
              </select>
            </Box>
            {/* 6. Time Range for Course Completion */}
            <Box style={{ minWidth: 200 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                Course Completion Time (min)
              </Typography>
              <Flex gap={2} alignItems="center">
                <input
                  type="number"
                  min="0"
                  value={filterTimeMin}
                  onChange={e => setFilterTimeMin(e.target.value)}
                  placeholder="Min"
                  style={{ width: 70, padding: '6px', border: '1px solid #dcdce4', borderRadius: 4 }}
                />
                <Typography variant="pi">to</Typography>
                <input
                  type="number"
                  min="0"
                  value={filterTimeMax}
                  onChange={e => setFilterTimeMax(e.target.value)}
                  placeholder="Max"
                  style={{ width: 70, padding: '6px', border: '1px solid #dcdce4', borderRadius: 4 }}
                />
              </Flex>
            </Box>
          </>
        )}
        {/* 3. Date Range (single icon, popup) */}
        <Box style={{ display: 'flex', flexDirection: 'column', minWidth: 260 }}>
          <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
            Date Range
          </Typography>
          <DateRangeInput
            value={{ start: dateFrom ? new Date(dateFrom) : null, end: dateTo ? new Date(dateTo) : null }}
            onChange={({ start, end }) => {
              if (!start && !end) {
                onDateFromChange(null);
                onDateToChange(null);
              } else if (start && end && start.getTime() !== end.getTime()) {
                onDateFromChange(start ? start.toISOString().slice(0, 10) : null);
                onDateToChange(end ? end.toISOString().slice(0, 10) : null);
              }
            }}
          />
        </Box>
        {/* Rest as before */}
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
        {showActivityTracking && viewMode === 'activityTracking' && (
          <Box style={{ minWidth: 180 }}>
            <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
              Pages
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
