import React from 'react';
import { Box, Typography } from '@strapi/design-system';
import { CHART_COLORS } from './chartColors';

/**
 * Cone-shaped funnel chart: Enrolled → Started → Completed → Certified.
 * data = [ { stage: 'Enrolled', value: n }, ... ]
 * Each segment is a trapezoid (wider at top, narrower at bottom).
 */
const SEGMENT_HEIGHT = 64;

export function FunnelChart({ data = [], title, dataKey = 'value', nameKey = 'stage', height = 320 }) {
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

  const maxValue = Math.max(...data.map((d) => Number(d[dataKey]) || 0), 1);

  return (
    <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
      <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 16 }}>
        {title}
      </Typography>
      <Box style={{ display: 'flex', alignItems: 'stretch', gap: 0, minHeight: height }}>
        {/* Labels column */}
        <Box style={{ width: 120, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', paddingRight: 12 }}>
          {data.map((d, i) => (
            <Box key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: SEGMENT_HEIGHT }}>
              <Box
                style={{
                  width: 10,
                  height: 2,
                  flexShrink: 0,
                  background: CHART_COLORS[i % CHART_COLORS.length],
                  borderRadius: 1,
                }}
              />
              <Box>
                <Typography variant="pi" fontWeight="semiBold" textColor="neutral800">
                  {d[nameKey]}
                </Typography>
                <Typography variant="pi" textColor="neutral600" marginLeft={2}>
                  {d[dataKey]} enrollments
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
        {/* Cone funnel */}
        <Box style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Box style={{ width: '100%', maxWidth: 320, margin: '0 auto' }}>
            {data.map((d, i) => {
              const value = Number(d[dataKey]) || 0;
              const nextValue = i < data.length - 1 ? (Number(data[i + 1][dataKey]) || 0) : value * 0.2;
              const wTop = value / maxValue;
              const wBottom = nextValue / maxValue;
              const leftTop = ((1 - wTop) / 2) * 100;
              const rightTop = ((1 + wTop) / 2) * 100;
              const leftBottom = ((1 - wBottom) / 2) * 100;
              const rightBottom = ((1 + wBottom) / 2) * 100;
              const clipPath = `polygon(${leftTop}% 0%, ${rightTop}% 0%, ${rightBottom}% 100%, ${leftBottom}% 100%)`;
              const color = CHART_COLORS[i % CHART_COLORS.length];
              return (
                <Box
                  key={i}
                  style={{
                    height: SEGMENT_HEIGHT,
                    marginBottom: i < data.length - 1 ? 2 : 0,
                    background: `linear-gradient(180deg, ${color} 0%, ${color}dd 100%)`,
                    clipPath,
                    WebkitClipPath: clipPath,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography variant="pi" fontWeight="bold" style={{ color: 'rgba(255,255,255,0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>
                    {String(value).padStart(2, '0')}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
