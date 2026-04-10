// @ts-nocheck

import React from 'react';
import { Box } from '@strapi/design-system';
import { DataTable } from '../../../components/DataTable';

/**
 * Learning Analytics – Employee Table view.
 * Receives data and filter state from parent; renders the employee learning summary table.
 */
function applyEmployeeFilters(rows, search, filterCourse) {
  const q = (search || '').toLowerCase().trim();
  let filtered = rows || [];
  if (filterCourse) {
    filtered = filtered.filter((row) => {
      if (Array.isArray(row.coursesEnrolledIds)) {
        return row.coursesEnrolledIds.includes(filterCourse);
      }
      if (Array.isArray(row.coursesEnrolled)) {
        return row.coursesEnrolled.some((c) => {
          if (typeof c === 'object') return String(c.id) === String(filterCourse);
          return String(c) === String(filterCourse);
        });
      }
      return true;
    });
  }
  if (q) {
    filtered = filtered.filter((row) => {
      const name = (row.employeeName || '').toLowerCase();
      return name.includes(q);
    });
    if (filtered.length > 1) {
      const empCodeMatch = q.match(/\b\d{3,}\b/);
      const empIdMatch = q.match(/emp\d{3,}/i);
      if (empCodeMatch) {
        filtered = filtered.filter((row) =>
          (row.emp_code || '').toLowerCase().includes(empCodeMatch[0])
        );
      } else if (empIdMatch) {
        filtered = filtered.filter((row) =>
          (row.emp_id || '').toLowerCase().includes(empIdMatch[0].toLowerCase())
        );
      }
    }
  }
  return filtered;
}

export function LearningTableView({
  data,
  allRows = [],
  search,
  filterCourse,
  sortOrder,
  setSortOrder,
  setPage,
  setPageSize,
}) {
  const [downloadStyle, setDownloadStyle] = React.useState('shown');
  const rows = data?.rows || [];
  const tableRows = allRows.length > 0 ? applyEmployeeFilters(allRows, search, filterCourse) : applyEmployeeFilters(rows, search, filterCourse);
  const paginatedTableData = data?.rows || [];

  const page = data?.page || 1;
  const pageSize = data?.pageSize || 10;
  const total = data?.total || 0;

  return (
    <Box marginBottom={6}>
      <DataTable
        data={downloadStyle === 'all' ? tableRows : paginatedTableData}
        fullData={tableRows}
        paginatedData={paginatedTableData}
        downloadStyle={downloadStyle}
        title="Employee Learning Summary"
        exportFileName="employee-learning-summary.xlsx"
        pagination={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: (v) => {
            setPageSize(Number(v));
            setPage(1);
          },
        }}
        sortBy="courseCompletionTimeMinutes"
              sortOrder={sortOrder}
              onSortChange={(_, order) => {
                setSortOrder(order);
                setPage(1);
              }}
              columns={[
                { key: 'employeeName', label: 'Employee Name' },
                { key: 'company', label: 'Company' },
                // { key: 'coursesEnrolled', label: 'Courses Enrolled' },
                { key: 'courseStatus', label: 'Course Status' },
                // { key: 'totalModulesDone', label: 'Total Modules Done' },
                { key: 'progressPercent', label: 'Progress %', render: (v) => `${v ?? 0}%` },
                { key: 'avgScore', label: 'Quiz Score' },
                {
                  key: 'courseCompletionTimeMinutes',
                  label: 'Completion Time',
                  sortable: true,
                  render: (v) => {
                    const m = Number(v);
                    if (Number.isNaN(m) || m < 0) return '—';
                    const h = Math.floor(m / 60);
                    const min = m % 60;
                    if (h === 0) return `${min}m`;
                    if (min === 0) return `${h}h`;
                    return `${h}h${min}m`;
                  },
                },
              ]}
            />
    </Box>
  );
}
