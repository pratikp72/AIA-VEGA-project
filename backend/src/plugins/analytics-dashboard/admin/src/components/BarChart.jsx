import React from 'react';
import { Box, Typography } from '@strapi/design-system';
import { BarChart as RechartsBar, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { getBarColor } from './chartColors';

export function BarChart({ data = [], title, dataKey = 'value', nameKey = 'name', height = 280 }) {
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
        <RechartsBar data={data} layout="vertical" margin={{ left: 80, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis type="number" />
          <YAxis type="category" dataKey={nameKey} width={70} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey={dataKey} name="Count" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={getBarColor(i)} />
            ))}
          </Bar>
        </RechartsBar>
      </ResponsiveContainer>
    </Box>
  );
}
