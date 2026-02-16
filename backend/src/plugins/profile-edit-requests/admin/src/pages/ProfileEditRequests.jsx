/**
 * Profile Edit Requests – search, filter, pagination; Approve/Reject with change preview.
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
  Modal,
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

export default function ProfileEditRequestsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showModal, setShowModal] = useState(false);
  
  const { get, put } = getFetchClient();
  const isMounted = useRef(true);

  const fetchList = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await get('/profile-edit-requests/requests');
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

  const updateStatus = async (documentId, newStatus, comment = '') => {
    const id = documentId != null ? String(documentId) : null;
    if (!id) return;
    setUpdatingId(id);
    setError(null);
    try {
      await put(`/profile-edit-requests/requests/${encodeURIComponent(id)}`, {
        data: { 
          request_status: newStatus,
          admin_comment: comment 
        }
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
        setShowModal(false);
        setSelectedRequest(null);
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
    const userName = userAttrs.username ?? userAttrs.email ?? userAttrs.employee_name ?? '—';
    const userId = user.id ?? '—';
    const statusRaw = attrs.request_status ?? entry.request_status ?? 'Pending';
    const statusVal = typeof statusRaw === 'string' ? statusRaw : 'Pending';
    const reason = attrs.reason ?? entry.reason ?? '—';
    const requestedChanges = attrs.requested_changes ?? entry.requested_changes ?? {};
    return { userName, userId, statusVal, reason, requestedChanges, attrs };
  };

  const filteredList = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    const status = (statusFilter || '').trim();
    return list.filter((entry) => {
      const { userName, statusVal } = getDisplayValues(entry);
      if (status && statusVal !== status) return false;
      if (!q) return true;
      return (userName && userName.toLowerCase().includes(q));
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

  const viewChanges = (entry) => {
    setSelectedRequest(entry);
    setShowModal(true);
  };

  const renderChangesPreview = (requestedChanges) => {
    if (!requestedChanges || typeof requestedChanges !== 'object') {
      return <Typography>No changes specified</Typography>;
    }

    return (
      <Box>
        {Object.entries(requestedChanges).map(([field, value]) => (
          <Flex key={field} padding={2} background="neutral100" marginBottom={2} hasRadius>
            <Box style={{ flex: 1 }}>
              <Typography variant="pi" fontWeight="bold">{field}:</Typography>
              <Typography variant="omega" style={{ marginLeft: 8 }}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </Typography>
            </Box>
          </Flex>
        ))}
      </Box>
    );
  };

  return (
    <Layouts.Root>
      <Layouts.Header
        title="Profile Edit Requests"
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
                placeholder="Employee name…"
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
              <Typography textColor="neutral600">No profile edit requests yet.</Typography>
            </Box>
          ) : totalFiltered === 0 ? (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">No requests match your search or filter.</Typography>
            </Box>
          ) : (
            <>
              <Box background="neutral0" hasRadius shadow="tableShadow" padding={6}>
                <Table colCount={6} rowCount={pageList.length}>
                  <Thead>
                    <Tr>
                      <Th>
                        <Typography variant="sigma">Employee</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">User ID</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Reason</Typography>
                      </Th>
                      <Th>
                        <Typography variant="sigma">Changes</Typography>
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
                      const { userName, userId, statusVal, reason, requestedChanges } = getDisplayValues(entry);
                      const isPending = statusVal === 'Pending';
                      const isUpdating = updatingId === idStr || updatingId === id;
                      const changeCount = requestedChanges ? Object.keys(requestedChanges).length : 0;

                      return (
                        <Tr key={idStr || entry.id || `row-${start + index}`}>
                          <Td>
                            <Typography variant="omega" style={TABLE_FONT_STYLE}>{userName}</Typography>
                          </Td>
                          <Td>
                            <Typography variant="omega" style={TABLE_FONT_STYLE}>{userId}</Typography>
                          </Td>
                          <Td>
                            <Typography variant="omega" style={TABLE_FONT_STYLE}>
                              {reason.length > 50 ? reason.substring(0, 50) + '...' : reason}
                            </Typography>
                          </Td>
                          <Td>
                            <Button
                              size="S"
                              variant="tertiary"
                              onClick={() => viewChanges(entry)}
                            >
                              View ({changeCount} field{changeCount !== 1 ? 's' : ''})
                            </Button>
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

        {/* Changes Preview Modal */}
        {showModal && selectedRequest && (
          <Modal.Root open={showModal} onOpenChange={(open) => !open && setShowModal(false)}>
            <Modal.Content>
              <Modal.Header>
                <Modal.Title>Requested Profile Changes</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                <Box padding={4}>
                  <Typography variant="omega" fontWeight="bold" marginBottom={4}>
                    Employee: {getDisplayValues(selectedRequest).userName}
                  </Typography>
                  {renderChangesPreview(getDisplayValues(selectedRequest).requestedChanges)}
                </Box>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onClick={() => setShowModal(false)}>
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Content>
          </Modal.Root>
        )}
      </Layouts.Content>
    </Layouts.Root>
  );
}
