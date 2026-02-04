import React from 'react';
import { Box, Typography } from '@strapi/design-system';
import { CHART_COLORS } from './chartColors';

const CARD_ACCENT_COLORS = CHART_COLORS.slice(0, 6);

export function StatCard({ label, value, subtext, colorIndex = 0 }) {
  const accentColor = CARD_ACCENT_COLORS[colorIndex % CARD_ACCENT_COLORS.length];
  return (
    <Box
      padding={4}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor="neutral200"
      borderWidth="1px"
      borderStyle="solid"
      style={{ borderLeftWidth: '4px', borderLeftColor: accentColor }}
    >
      <Typography variant="sigma" textColor="neutral600" fontWeight="regular">
        {label}
      </Typography>
      <Typography variant="alpha" fontWeight="bold" as="p" style={{ marginTop: 4, fontSize: '1.75rem', color: accentColor }}>
        {value ?? '—'}
      </Typography>
      {subtext && (
        <Typography variant="pi" textColor="neutral500" style={{ marginTop: 2 }}>
          {subtext}
        </Typography>
      )}
    </Box>
  );
}
