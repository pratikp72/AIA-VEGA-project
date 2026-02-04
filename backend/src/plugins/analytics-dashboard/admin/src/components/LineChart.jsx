import React from 'react';
import { Box, Typography } from '@strapi/design-system';
import { LineChart as RechartsLine, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CHART_COLORS } from './chartColors';

export function LineChart({ data = [], title, dataKey = 'value', nameKey = 'month', height = 280 }) {
  if (!data || data.length === 0) {
    return (
      <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
        <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
          {title}
        </Typography>
        <Typography variant="pi" textColor="neutral500">
          No data available
        </Typography>
      </Box>
    );
  }

  return (
    <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
      <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
        {title}
      </Typography>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsLine data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey={nameKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey={dataKey} stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 4, fill: CHART_COLORS[2] }} name="Completions" />
        </RechartsLine>
      </ResponsiveContainer>
    </Box>
  );
}
