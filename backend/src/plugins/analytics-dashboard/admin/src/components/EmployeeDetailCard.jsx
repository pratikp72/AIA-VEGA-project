import React from 'react';
import { Box, Typography } from '@strapi/design-system';
import { CHART_COLORS } from './chartColors';

export function EmployeeDetailCard({ employee }) {
  if (!employee) return null;

  const accentColor = CHART_COLORS[0];
  const rows = [
    { label: 'Name', value: employee.employee_name || employee.email || `User ${employee.id}` },
    { label: 'Email', value: employee.email || '—' },
    { label: 'Department', value: employee.department || '—' },
    { label: 'Designation', value: employee.designation || '—' },
    { label: 'Company', value: employee.company || '—' },
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
      style={{ borderLeftWidth: '4px', borderLeftColor: accentColor, marginBottom: 24 }}
    >
      <Typography variant="sigma" textColor="neutral600" fontWeight="bold" style={{ marginBottom: 12 }}>
        Employee Details
      </Typography>
      <Box as="dl" style={{ margin: 0 }}>
        {rows.map(({ label, value }) => (
          <Box key={label} as="div" paddingTop={2} paddingBottom={2} style={{ borderBottom: '1px solid #eaeaef' }}>
            <Typography variant="pi" textColor="neutral600" as="dt" style={{ margin: 0, fontWeight: 500 }}>
              {label}
            </Typography>
            <Typography variant="pi" textColor="neutral800" as="dd" style={{ margin: '4px 0 0 0' }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
