//@ts-ignore

import React, { useState, useEffect, useRef } from 'react';
import { Layouts } from '@strapi/strapi/admin';
import { Box, Typography, Table, Thead, Tbody, Tr, Th, Td, Flex, Loader, Badge, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import DateRangeInput from '../../../../analytics-dashboard/admin/src/components/DateRangeInput';
import { getFetchClient } from '@strapi/strapi/admin';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';

const TABLE_FONT_STYLE = { fontSize: '14px' };

const AuditLogPage = () => {
    const [search, setSearch] = useState('');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0 });
  // pageSize state for DataTable
  const [pageSize, setPageSize] = useState(25);
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

  const fetchLogs = async (page = 1, pageSizeArg) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: (pageSizeArg || pageSize).toString(),
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
        setPagination({ page, pageSize: pageSizeArg, total: data.pagination?.total || 0 });
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
    fetchLogs(1, pageSize);
    return () => {
      isMounted.current = false;
    };
  }, [pageSize]);

  // Reload when filters change
  useEffect(() => {
    fetchLogs(1, pageSize); // Reset to page 1 when filters change
  }, [dateRange, action, companyFilter, pageSize]);

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
    fetchLogs(newPage, pageSize);
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
              <Box style={{ minWidth: 220 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Search
                </Typography>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={companyFilter.toLowerCase() === 'aia' ? 'Employee code (digits)' : companyFilter.toLowerCase() === 'vega' ? 'EMP ID (EMP12345)' : 'User, company, ID, etc.'}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    width: '100%',
                  }}
                />
              </Box>
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
            </Flex>
          </Box>

          {/* Audit Log Table */}
          {/* <Box background="neutral0" hasRadius shadow="tableShadow" padding={6}> */}
            <DataTable
              data={
                logs
                  .filter((log) => {
                    const q = (search || '').toLowerCase().trim();
                    const company = (log.user?.company || log.company || '').toLowerCase();
                    // Company filter
                    if (companyFilter && company !== companyFilter.toLowerCase()) return false;
                    // Enhanced search
                    if (!q) return true;
                    const user = log.user || {};
                    const matches = (
                      (user.username && user.username.toLowerCase().includes(q)) ||
                      (user.firstname && user.firstname.toLowerCase().includes(q)) ||
                      (user.lastname && user.lastname.toLowerCase().includes(q)) ||
                      (user.emp_code && String(user.emp_code).toLowerCase().includes(q)) ||
                      (user.emp_id && String(user.emp_id).toLowerCase().includes(q)) ||
                      (user.id && String(user.id).toLowerCase().includes(q)) ||
                      (log.userId && String(log.userId).toLowerCase().includes(q))
                    );
                    // Company-specific strictness
                    if (company === 'aia' && /^\d+$/.test(q)) {
                      return user.emp_code && String(user.emp_code).includes(q);
                    } else if (company === 'vega' && /^emp\d+$/i.test(q)) {
                      return user.emp_id && String(user.emp_id).toLowerCase().includes(q);
                    }
                    return matches;
                  })
                  .slice((pagination.page - 1) * pageSize, (pagination.page - 1) * pageSize + pageSize)
              }
              columns={[
                { key: 'createdAt', label: 'Date & Time', render: (val) => <Typography variant="omega">{formatDate(val)}</Typography> },
                { key: 'action', label: 'Action', render: (val) => <Badge variant={getActionColor(val)}>{val}</Badge> },
                { key: 'userId', label: 'User ID', render: (val, row) => {
                    const user = row.user || {};
                    const company = (user.company || row.company || '').toLowerCase();
                    if (company === 'aia') {
                      return <Typography variant="omega" style={TABLE_FONT_STYLE}>{user.emp_code || '—'}</Typography>;
                    } else if (company === 'vega') {
                      return <Typography variant="omega" style={TABLE_FONT_STYLE}>{user.emp_id || '—'}</Typography>;
                    } else {
                      return <Typography variant="omega" style={TABLE_FONT_STYLE}>{row.userId || '—'}</Typography>;
                    }
                  }
                },
                { key: 'userName', label: 'User Name', render: (val, row) => row.user?.username || row.userName || '—' },
                { key: 'company', label: 'Company', render: (val, row) => row.user?.company || row.company || '—' },
                { key: 'adminUser', label: 'Changed By', render: (val, row) => val ? `${val.firstname} ${val.lastname}` : 'System' },
                { key: 'changes', label: 'Changes', render: (val) => val && val.length > 0 ? val.map(c => c.field).join(', ') : '—' },
              ]}
              pagination={{
                page: pagination.page,
                pageSize: pageSize,
                total: pagination.total,
                onPageChange: handlePageChange,
                onPageSizeChange: (newSize) => {
                  setPageSize(Number(newSize));
                  setPagination((prev) => ({ ...prev, page: 1, pageSize: Number(newSize) }));
                  // Immediately fetch logs with new page size
                  fetchLogs(1, Number(newSize));
                },
              }}
              exportFileName={`audit-log-${new Date().toISOString().split('T')[0]}.xlsx`}
              fontSize={TABLE_FONT_STYLE.fontSize}
            />
          {/* </Box> */}
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
};

export default AuditLogPage;