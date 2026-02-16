/**
 * Quiz Reattempt Requests – search, filter, pagination; Approve/Reject per row.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Layouts } from '@strapi/strapi/admin';
import {
  Box,
  Typography,
  Button,
  Flex,
  Loader,
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
  Badge,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import { getFetchClient } from '@strapi/strapi/admin';

const PAGE_SIZE = 10;
const TABLE_FONT_STYLE = { fontSize: '15px' };
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
];

export default function QuizReattemptRequestsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  
  const { get, put } = getFetchClient();
  const isMounted = useRef(true);

  const fetchList = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await get('/quiz-reattempt-requests/requests');
      const rows = Array.isArray(data.data) ? data.data : (data.results || data) || [];
      if (isMounted.current) {
        setList(Array.isArray(rows) ? rows : []);
      }
    } catch (e) {
      if (isMounted.current) {
        setError(e.message || 'Failed to load');
        setList([]);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchList();
    return () => {
      isMounted.current = false;
    };
  }, []);

  const updateStatus = async (documentId, newStatus) => {
    const id = documentId != null ? String(documentId) : null;
    if (!id) return;
    setUpdatingId(id);
    setError(null);
    try {
      await put(`/quiz-reattempt-requests/requests/${encodeURIComponent(id)}`, {
        data: { request_status: newStatus }
      });
      
      if (isMounted.current) {
        setList((prev) =>
          prev.map((e) => {
            const eid = e.documentId ?? e.id ?? e._id;
            if (eid == null || String(eid) !== id) return e;
            return { ...e, request_status: newStatus };
          })
        );
        await fetchList();
      }
    } catch (e) {
      if (isMounted.current) {
        setError(e.message || 'Update failed');
      }
    } finally {
      if (isMounted.current) {
        setUpdatingId(null);
      }
    }
  };

  const entryId = (entry) => entry.documentId ?? entry.id ?? entry._id;

  const getDisplayValues = (entry) => {
    const attrs = entry.attributes || entry;
    const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
    const userAttrs = user.attributes ?? user;
    const course = attrs.course?.data ?? attrs.course ?? {};
    const courseAttrs = course.attributes ?? course;
    const userName = userAttrs.username ?? userAttrs.email ?? userAttrs.employee_name ?? '—';
    const courseTitle = courseAttrs.title ?? '—';
    const statusRaw = attrs.request_status ?? entry.request_status ?? 'Pending';
    const statusVal = typeof statusRaw === 'string' ? statusRaw : 'Pending';
    return { userName, courseTitle, statusVal, attrs };
  };

  const filteredList = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    const status = (statusFilter || '').trim();
    return list.filter((entry) => {
      const { userName, courseTitle, statusVal } = getDisplayValues(entry);
      if (status && statusVal !== status) return false;
      if (!q) return true;
      return (
        (userName && userName.toLowerCase().includes(q)) ||
        (courseTitle && courseTitle.toLowerCase().includes(q))
      );
    });
  }, [list, search, statusFilter]);

  const totalFiltered = filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageList = filteredList.slice(start, start + PAGE_SIZE);

  useEffect(() => {
    if (currentPage !== page) setPage(currentPage);
  }, [currentPage, page]);

  return (
    <Layouts.Root>
      <Layouts.Header
        title="Quiz Reattempt Requests"
        subtitle={
          loading
            ? 'Loading…'
            : `${list.length} request${list.length === 1 ? '' : 's'}`
        }
      />
      <Layouts.Content>
        <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
          {error && (
            <Box padding={4} background="danger100" hasRadius marginBottom={4}>
              <Typography textColor="danger700">{error}</Typography>
            </Box>
          )}

          {/* Search and filter */}
          <Flex gap={4} marginBottom={4} wrap="wrap" alignItems="flex-end">
            <Box style={{ minWidth: 220 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                Search
              </Typography>
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="User or course…"
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  width: '100%',
                }}
              />
            </Box>
            <Box style={{ minWidth: 140 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                Status
              </Typography>
              <SingleSelect
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(String(v || ''));
                  setPage(1);
                }}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <SingleSelectOption key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Box>
          </Flex>

          {loading ? (
            <Flex justifyContent="center" padding={8}>
              <Loader>Loading...</Loader>
            </Flex>
          ) : list.length === 0 ? (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">No quiz reattempt requests yet.</Typography>
            </Box>
          ) : totalFiltered === 0 ? (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">No requests match your search or filter.</Typography>
            </Box>
          ) : (
            <>
              <Box background="neutral0" hasRadius shadow="tableShadow" padding={6}>
                <Table colCount={5} rowCount={pageList.length}>
                  <Thead>
                    <Tr>
                      <Th>
                        <Typography variant="sigma">User</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Course</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Requested attempt</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Status</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Actions</Typography>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {pageList.map((entry, index) => {
                      const id = entryId(entry);
                      const idStr = id != null ? String(id) : '';
                      const { userName, courseTitle, statusVal, attrs } = getDisplayValues(entry);
                      const isPending = statusVal === 'Pending';
                      const isUpdating = updatingId === idStr || updatingId === id;

                      return (
                        <Tr key={idStr || entry.id || `row-${start + index}`}>
                          <Td>
                            <Typography variant="omega" style={TABLE_FONT_STYLE}>{userName}</Typography>
                          </Td>
                          <Td>
                            <Typography variant="omega" style={TABLE_FONT_STYLE}>{courseTitle}</Typography>
                          </Td>
                          <Td>
                            <Typography variant="omega" style={TABLE_FONT_STYLE}>{attrs.requested_for_attempt ?? '—'}</Typography>
                          </Td>
                          <Td>
                            <Badge
                              variant={
                                statusVal === 'Approved'
                                  ? 'success'
                                  : statusVal === 'Rejected'
                                  ? 'danger'
                                  : 'warning'
                              }
                            >
                              {statusVal}
                            </Badge>
                          </Td>
                          <Td>
                            {isPending ? (
                              <Flex gap={2}>
                                <Button
                                  size="S"
                                  variant="default"
                                  disabled={isUpdating}
                                  onClick={() => updateStatus(id, 'Approved')}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="S"
                                  variant="danger"
                                  disabled={isUpdating}
                                  onClick={() => updateStatus(id, 'Rejected')}
                                >
                                  Reject
                                </Button>
                              </Flex>
                            ) : (
                              <Typography variant="omega" textColor="neutral600" style={TABLE_FONT_STYLE}>
                                —
                              </Typography>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <Flex justifyContent="space-between" alignItems="center" marginTop={4} paddingTop={4}>
                    <Typography variant="pi" textColor="neutral600">
                      {start + 1}–{Math.min(start + PAGE_SIZE, totalFiltered)} of {totalFiltered}
                    </Typography>
                    <Flex gap={2}>
                      <Button
                        variant="tertiary"
                        size="S"
                        disabled={currentPage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <Typography variant="pi" style={{ alignSelf: 'center' }}>
                        Page {currentPage} of {totalPages}
                      </Typography>
                      <Button
                        variant="tertiary"
                        size="S"
                        disabled={currentPage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Next
                      </Button>
                    </Flex>
                  </Flex>
                )}
              </Box>
            </>
          )}
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
}
