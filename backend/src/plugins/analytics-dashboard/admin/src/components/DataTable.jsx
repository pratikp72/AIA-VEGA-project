import React from 'react';
import { Box, Typography, Table, Thead, Tbody, Tr, Th, Td, Button, Flex } from '@strapi/design-system';

export function DataTable({ data = [], columns = [], title, pagination = null, sortBy = null, sortOrder = 'asc', onSortChange = null, fontSize }) {
  if (!data || data.length === 0) {
    return (
      <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
        {title && (
          <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 12 }}>
            {title}
          </Typography>
        )}
        <Typography variant="pi" textColor="neutral500">
          No data available
        </Typography>
      </Box>
    );
  }

  const { page = 1, pageSize = 10, total = 0, onPageChange, onPageSizeChange } = pagination || {};
  const totalPages = Math.ceil(total / pageSize) || 1;
  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, total);

  return (
    <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" borderColor="neutral200" borderWidth="1px" borderStyle="solid">
      <Flex justifyContent="space-between" alignItems="center" marginBottom={4} wrap="wrap" gap={2}>
        {title && (
          <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold">
            {title}
          </Typography>
        )}
        {pagination && total > 0 && (
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Typography variant="pi" textColor="neutral600">
              Rows per page:
            </Typography>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange?.(e.target.value)}
              style={{
                padding: '4px 8px',
                border: '1px solid #dcdce4',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Typography variant="pi" textColor="neutral600">
              {startRow}-{endRow} of {total}
            </Typography>
            <Button
              variant="tertiary"
              size="S"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
            >
              Previous
            </Button>
            <Typography variant="pi" textColor="neutral600">
              Page {page} of {totalPages}
            </Typography>
            <Button
              variant="tertiary"
              size="S"
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(page + 1)}
            >
              Next
            </Button>
          </Flex>
        )}
      </Flex>
      <Box style={fontSize ? { fontSize } : undefined}>
        <Table colCount={columns.length} rowCount={data.length}>
          <Thead>
            <Tr>
              {columns.map((col) => {
                const sortKey = col.sortKey ?? col.key;
                const isSortable = col.sortable && onSortChange;
                const isActive = sortBy === sortKey;
                const handleSort = () => {
                  if (!isSortable) return;
                  const nextOrder = isActive && sortOrder === 'desc' ? 'asc' : 'desc';
                  onSortChange(sortKey, nextOrder);
                };
                const sortLabel = isActive
                  ? sortOrder === 'asc'
                    ? 'Sorted ascending (click to sort descending)'
                    : 'Sorted descending (click to sort ascending)'
                  : 'Click to sort by this column';
                return (
                  <Th key={col.key}>
                    <Flex
                      alignItems="center"
                      gap={1}
                      style={{ cursor: isSortable ? 'pointer' : 'default' }}
                      onClick={handleSort}
                      title={isSortable ? sortLabel : undefined}
                    >
                      <Typography variant="sigma" textColor="neutral600">{col.label}</Typography>
                      {isSortable && (
                        <span
                          style={{ fontSize: 11, color: isActive ? '#4945ff' : '#666' }}
                          title={sortLabel}
                        >
                          {isActive ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : ' ↕'}
                          <span style={{ marginLeft: 2, fontWeight: 'normal', opacity: 0.9 }}>(Sort)</span>
                        </span>
                      )}
                    </Flex>
                  </Th>
                );
              })}
            </Tr>
          </Thead>
          <Tbody>
            {data.map((row, i) => (
              <Tr key={i}>
                {columns.map((col) => (
                  <Td key={col.key}>
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </Td>
                ))}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </Box>
  );
}
