import React from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';
import { LineChart as RechartsLine, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CHART_COLORS } from './chartColors';

export const ACTIVITY_LABELS = {
  News_Reading: 'News Reading',
  Event_Info: 'Event Info',
  Townhall_Video: 'Townhall (Video)',
  Townhall_PDF: 'Townhall PDF View',
  Holiday_View: 'Holiday View',
};

export function MultiLineChart({ data = [], title, lines = [], nameKey = 'day', height = 280 }) {
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

  const defaultLines = ['News_Reading', 'Event_Info', 'Townhall_PDF', 'Townhall_Video', 'Holiday_View'];
  const lineKeys = lines.length > 0 ? lines : defaultLines;

  return (
    <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
      <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
        {title}
      </Typography>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsLine data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis dataKey={nameKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} label={{ value: 'Minutes', angle: -90, position: 'insideLeft' }} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const colorMap = {};
              lineKeys.forEach((key, idx) => {
                colorMap[key] = CHART_COLORS[idx % CHART_COLORS.length];
              });
              return (
                <Box
                  padding={3}
                  hasRadius
                  shadow="tableShadow"
                  style={{ background: '#fff', border: '1px solid #dcdce4' }}
                >
                  <Typography variant="sigma" style={{ color: '#32324d', marginBottom: 8, display: 'block' }}>
                    {label}
                  </Typography>
                  <Flex direction="column" gap={2}>
                    {payload.map((entry, i) => {
                      const lineColor = entry.color || colorMap[entry.name] || CHART_COLORS[i % CHART_COLORS.length];
                      return (
                        <Flex key={i} alignItems="center" gap={2}>
                          <Box
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 2,
                              background: lineColor,
                              flexShrink: 0,
                            }}
                          />
                          <Typography variant="pi" as="div" style={{ color: lineColor, display: 'block', fontWeight: 500 }}>
                            {ACTIVITY_LABELS[entry.name] || entry.name}: {entry.value} min
                          </Typography>
                        </Flex>
                      );
                    })}
                  </Flex>
                </Box>
              );
            }}
          />
          <Legend />
          {lineKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 4 }}
              name={ACTIVITY_LABELS[key] || key}
            />
          ))}
        </RechartsLine>
      </ResponsiveContainer>
    </Box>
  );
}
