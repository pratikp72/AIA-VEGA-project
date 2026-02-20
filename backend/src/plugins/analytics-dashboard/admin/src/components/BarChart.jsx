import React from 'react';
import { Box, Typography } from '@strapi/design-system';
import { BarChart as RechartsBar, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
// @ts-ignore: Suppress type error for layout prop
import { getBarColor } from './chartColors';

/**
 * @param {Object} props
 * @param {Array} props.data
 * @param {string} props.title
 * @param {string} [props.dataKey]
 * @param {string} [props.nameKey]
 * @param {number} [props.height]
 * @param {string} [props.valueLabel]
 * @param {string} [props.valueUnit]
 * @param {'horizontal'|'vertical'} [props.layout]
 */
export function BarChart({ data = [], title, dataKey = 'value', nameKey = 'name', height = 280, valueLabel = 'Value', valueUnit = '', layout = 'vertical' }) {
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
        {/* layout prop is a string, no type assertion needed */}
        <RechartsBar data={data} layout={layout} margin={layout === 'vertical' ? { left: 80, right: 20 } : { top: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          {layout === 'vertical' ? (
            <>
              <XAxis type="number" label={{ value: valueLabel + (valueUnit ? ` (${valueUnit})` : ''), position: 'insideBottomRight', offset: 0 }} tickFormatter={v => valueUnit ? `${v} ${valueUnit}` : v} />
              <YAxis type="category" dataKey={nameKey} width={70} tick={{ fontSize: 12 }} />
            </>
          ) : (
            <>
              <XAxis type="category" dataKey={nameKey} tick={{ fontSize: 12 }} />
              <YAxis type="number" label={{ value: valueLabel + (valueUnit ? ` (${valueUnit})` : ''), angle: -90, position: 'insideLeft' }} tickFormatter={v => valueUnit ? `${v} ${valueUnit}` : v} />
            </>
          )}
          <Tooltip formatter={v => valueUnit ? `${v} ${valueUnit}` : v} labelFormatter={l => l} />
          <Legend />
          <Bar dataKey={dataKey} name={valueLabel} radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={getBarColor(i)} />
            ))}
          </Bar>
        </RechartsBar>
      </ResponsiveContainer>
    </Box>
  );
}
