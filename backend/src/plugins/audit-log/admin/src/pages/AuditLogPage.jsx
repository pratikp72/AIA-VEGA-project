import React, { useState, useEffect, useRef } from 'react';
import { Layouts } from '@strapi/strapi/admin';
import { Box, Typography, Table, Thead, Tbody, Tr, Th, Td, Flex, Loader, Badge, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { getFetchClient } from '@strapi/strapi/admin';

const AuditLogPage = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0 });
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [action, setAction] = useState('');
  const contentType = 'plugin::users-permissions.user'; // Fixed to user collection

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

      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      params.append('contentType', contentType); // Always filter by user collection
      if (action) params.append('action', action);

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
  }, [dateFrom, dateTo, action]);

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
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Date From
                </Typography>
                <input
                  type="date"
                  value={dateFrom || ''}
                  onChange={(e) => setDateFrom(e.target.value || null)}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    width: '100%',
                  }}
                />
              </Box>
              <Box style={{ minWidth: 180 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
                  Date To
                </Typography>
                <input
                  type="date"
                  value={dateTo || ''}
                  onChange={(e) => setDateTo(e.target.value || null)}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #dcdce4',
                    borderRadius: '4px',
                    fontSize: '14px',
                    width: '100%',
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
          <Box background="neutral0" hasRadius shadow="tableShadow" padding={6}>
            {/* <Typography variant="delta" marginBottom={4}>
              User Change History
            </Typography> */}
            {loading ? (
              <Flex justifyContent="center" padding={8}>
                <Loader>Loading audit logs...</Loader>
              </Flex>
            ) : (
              <>
                <Table colCount={5} rowCount={logs.length}>
                  <Thead>
                    <Tr>
                      <Th>
                        <Typography variant="sigma">Date & Time</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Action</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">User ID</Typography>
                      </Th>
                      <Th> 
                        <Typography variant="sigma">Company</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Changed By</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Changes</Typography>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {logs.length === 0 ? (
                      <Tr>
                        <Td colSpan={5}>
                          <Typography textAlign="center" textColor="neutral600">
                            No user changes found
                          </Typography>
                        </Td>
                      </Tr>
                    ) : (
                      logs.map((log) => (
                        <Tr key={log.id}>
                          <Td>
                            <Typography variant="omega" fontWeight="regular">
                              {formatDate(log.createdAt)}
                            </Typography>
                          </Td>
                          <Td>
                            <Badge variant={getActionColor(log.action)}>
                              {log.action.toUpperCase()}
                            </Badge>
                          </Td>
                          <Td>
                            <Typography variant="omega">{log.entryId}</Typography>
                          </Td>
                          <Td>
                            <Typography variant="omega">{log.data?.company || '—'}</Typography>
                          </Td>
                          <Td>
                            <Typography variant="omega">
                              {log.adminUser 
                                ? `${log.adminUser.firstname} ${log.adminUser.lastname}` 
                                : 'System'}
                            </Typography>
                          </Td>
                          <Td>
                            {log.changes && log.changes.length > 0 ? (
                              <Typography variant="omega" textColor="neutral600">
                                {log.changes.map(c => c.field).join(', ')}
                              </Typography>
                            ) : (
                              <Typography variant="omega" textColor="neutral500">
                                —
                              </Typography>
                            )}
                          </Td>
                        </Tr>
                      ))
                    )}
                  </Tbody>
                </Table>
                
                {/* Pagination */}
                {pagination.total > pagination.pageSize && (
                  <Flex justifyContent="space-between" marginTop={4}>
                    <Typography variant="pi" textColor="neutral600">
                      Showing {((pagination.page - 1) * pagination.pageSize) + 1} - {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
                    </Typography>
                    <Flex gap={2}>
                      <button
                        onClick={() => handlePageChange(pagination.page - 1)}
                        disabled={pagination.page === 1}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #dcdce4',
                          borderRadius: '4px',
                          background: pagination.page === 1 ? '#f6f6f9' : 'white',
                          cursor: pagination.page === 1 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Previous
                      </button>
                      <Typography variant="pi" style={{ padding: '6px 12px' }}>
                        Page {pagination.page} of {Math.ceil(pagination.total / pagination.pageSize)}
                      </Typography>
                      <button
                        onClick={() => handlePageChange(pagination.page + 1)}
                        disabled={pagination.page >= Math.ceil(pagination.total / pagination.pageSize)}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #dcdce4',
                          borderRadius: '4px',
                          background: pagination.page >= Math.ceil(pagination.total / pagination.pageSize) ? '#f6f6f9' : 'white',
                          cursor: pagination.page >= Math.ceil(pagination.total / pagination.pageSize) ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Next
                      </button>
                    </Flex>
                  </Flex>
                )}
              </>
            )}
          </Box>
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
};

export default AuditLogPage;