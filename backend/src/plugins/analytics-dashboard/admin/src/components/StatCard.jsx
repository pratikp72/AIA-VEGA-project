import React from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';
import { CHART_COLORS } from './chartColors';

const CARD_ACCENT_COLORS = CHART_COLORS.slice(0, 6);

export function StatCard({ label, value, subtext = null, colorIndex = 0 }) {
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
      <Flex alignItems="baseline" gap={1} wrap="wrap" style={{ marginTop: 4 }}>
        <Typography variant="alpha" fontWeight="bold" as="p" style={{ fontSize: '1.75rem', color: accentColor }}>
          {value ?? '—'}
        </Typography>
        {subtext && (
          <Typography variant="pi" textColor="neutral500" style={{ fontSize: '12px' }}>
            {subtext}
          </Typography>
        )}
      </Flex>
    </Box>
  );
}
