//@ts-ignore

import React, { useState, useEffect, useRef } from 'react';
import { Layouts } from '@strapi/strapi/admin';
import { Box, Typography, Table, Thead, Tbody, Tr, Th, Td, Flex, Loader, Badge, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import DateRangeInput from '../../../../analytics-dashboard/admin/src/components/DateRangeInput';
import { getFetchClient } from '@strapi/strapi/admin';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';

const AuditLogPage = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0 });
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  const [action, setAction] = useState('');
  const contentType = 'plugin::users-permissions.user'; // Fixed to user collection
  const COMPANY_OPTIONS = [
    { value: '', label: 'All Companies' },
    { value: 'AIA', label: 'AIA' },
    { value: 'Vega', label: 'Vega' },
  ];
  const [companyFilter, setCompanyFilter] = useState('');

  const { get } = getFetchClient();
  const isMounted = useRef(true);

  const fetchLogs = async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: '25',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      if (dateRange.start) params.append('dateFrom', dateRange.start.toISOString().slice(0, 10));
      if (dateRange.end) params.append('dateTo', dateRange.end.toISOString().slice(0, 10));
      params.append('contentType', contentType); // Always filter by user collection
      if (action) params.append('action', action);
      if (companyFilter) params.append('company', companyFilter);

      const { data } = await get(`/audit-log/logs?${params}`);
      
      if (isMounted.current) {
        setLogs(data.data || []);
        setPagination({ page, pageSize: 25, total: data.pagination?.total || 0 });
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  // Initial load
  useEffect(() => {
    fetchLogs(1);
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Reload when filters change
  useEffect(() => {
    fetchLogs(1); // Reset to page 1 when filters change
  }, [dateRange, action, companyFilter]);

  const getActionColor = (action) => {
    switch (action) {
      case 'created': return 'success';
      case 'updated': return 'warning';
      case 'deleted': return 'danger';
      default: return 'neutral';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePageChange = (newPage) => {
    fetchLogs(newPage);
  };

  return (
    <Layouts.Root>
      <Layouts.Header
        title="Employee Data Changes"
        subtitle="Track all changes made to user/employee accounts"
      />
      <Layouts.Content>
        <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
          {/* Filters */}
          <Box
            padding={4}
            background="neutral0"
            hasRadius
            shadow="tableShadow"
            marginBottom={6}
          >
            <Typography variant="sigma" textColor="neutral600" marginBottom={3}>
              Filters
            </Typography>
            <Flex gap={4} wrap="wrap">
              <Box style={{ minWidth: 260 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Date Range
                </Typography>
                <DateRangeInput
                  value={dateRange}
                  onChange={({ start, end }) => {
                    setDateRange({ start, end });
                  }}
                />
              </Box>
              <Box style={{ minWidth: 150 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Action
                </Typography>
                <SingleSelect
                  value={action}
                  onChange={(value) => setAction(String(value))}
                >
                  <SingleSelectOption value="">All Actions</SingleSelectOption>
                  <SingleSelectOption value="created">Created</SingleSelectOption>
                  <SingleSelectOption value="updated">Updated</SingleSelectOption>
                  <SingleSelectOption value="deleted">Deleted</SingleSelectOption>
                </SingleSelect>
              </Box>
              <Box style={{ minWidth: 160 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Company
                </Typography>
                <SingleSelect
                  value={companyFilter}
                  onChange={(v) => setCompanyFilter(String(v || ''))}
                >
                  {COMPANY_OPTIONS.map((opt) => (
                    <SingleSelectOption key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Box>
            </Flex>
          </Box>

          {/* Audit Log Table */}
          <Box background="neutral0" hasRadius shadow="tableShadow" padding={6}>
            <DataTable
              data={logs}
              columns={[
                { key: 'createdAt', label: 'Date & Time', render: (val) => <Typography variant="omega">{formatDate(val)}</Typography> },
                { key: 'action', label: 'Action', render: (val) => <Badge variant={getActionColor(val)}>{val}</Badge> },
                { key: 'userId', label: 'User ID', render: (val, row) => row.user?.id || row.userId || '—' },
                { key: 'company', label: 'Company', render: (val, row) => row.user?.company || row.company || '—' },
                { key: 'adminUser', label: 'Changed By', render: (val, row) => val ? `${val.firstname} ${val.lastname}` : 'System' },
                { key: 'changes', label: 'Changes', render: (val) => val && val.length > 0 ? val.map(c => c.field).join(', ') : '—' },
              ]}
              pagination={{
                page: pagination.page,
                pageSize: pagination.pageSize,
                total: pagination.total,
                onPageChange: handlePageChange,
                onPageSizeChange: () => {},
              }}
              exportFileName={`audit-log-${new Date().toISOString().split('T')[0]}.xlsx`}
            />
          </Box>
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
};

export default AuditLogPage;