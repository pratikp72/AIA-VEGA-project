import React from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';
import { CHART_COLORS } from './chartColors';

const accentColor = CHART_COLORS[0];

function Item({ label, value }) {
  return (
    <Box style={{ minWidth: 0, flex: 1 }}>
      <Typography variant="sigma" textColor="neutral600" fontWeight="regular">
        {label}
      </Typography>
      <Typography variant="pi" fontWeight="bold" textColor="neutral800" as="p" style={{ marginTop: 4 }}>
        {value ?? '—'}
      </Typography>
    </Box>
  );
}

export function EmployeeDetailCard({ employee }) {
  if (!employee) return null;

  const name = employee.username || employee.email || `User ${employee.id}`;
  const email = employee.email || '—';
  const department = employee.department || '—';
  const company = employee.company || '—';

  return (
    <Box
      padding={4}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor="neutral200"
      borderWidth="1px"
      borderStyle="solid"
      style={{ borderLeftWidth: '4px', borderLeftColor: accentColor, width: '100%', marginBottom: 24 }}
    >
      <Flex gap={6} alignItems="flex-start" wrap="nowrap" style={{ width: '100%' }}>
        <Item label="Name" value={name} />
        <Item label="Email" value={email} />
        <Item label="Department" value={department} />
        <Item label="Company" value={company} />
      </Flex>
    </Box>
  );
}
