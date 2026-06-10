/**
 * Quiz Reattempt Requests – search, filter, pagination; review via modal.
 */

// @ts-nocheck

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Layouts } from '@strapi/strapi/admin';
import {
  Box,
  Typography,
  Button,
  Flex,
  Loader,
  Badge,
  SingleSelect,
  SingleSelectOption,
  Modal,
  IconButton,
} from '@strapi/design-system';
import { Pencil } from '@strapi/icons';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';
import { getFetchClient } from '@strapi/strapi/admin';

const DEFAULT_PAGE_SIZE = 10;
const TABLE_FONT_STYLE = { fontSize: '14px' };
const INPUT_STYLE = {
  padding: '8px 12px',
  border: '1px solid #dcdce4',
  borderRadius: '4px',
  fontSize: '14px',
  width: '100%',
  maxWidth: '220px',
};
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
];

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getAssignmentDueInfo(entry) {
  const attrs = entry?.attributes || entry || {};
  return attrs.assignment_due_date || entry?.assignment_due_date || {};
}

function dueStatusBadgeVariant(dueStatus) {
  if (dueStatus === 'past_due') return 'danger';
  if (dueStatus === 'due_today') return 'warning';
  if (dueStatus === 'upcoming') return 'success';
  return 'secondary';
}

function DetailField({ label, value }) {
  return (
    <Box>
      <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="omega" textColor="neutral800">
        {value ?? '—'}
      </Typography>
    </Box>
  );
}

export default function QuizReattemptRequestsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalError, setModalError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [extendDueDate, setExtendDueDate] = useState(false);
  const [newDueDate, setNewDueDate] = useState('');

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

  const updateStatus = async (documentId, newStatus, options = {}) => {
    const id = documentId != null ? String(documentId) : null;
    if (!id) return;
    setUpdatingId(id);
    setModalError(null);
    setError(null);
    try {
      const payload = { request_status: newStatus };
      if (options.extendedDueDate) {
        payload.extended_due_date = options.extendedDueDate;
      }

      await put(`/quiz-reattempt-requests/requests/${encodeURIComponent(id)}`, {
        data: payload,
      });

      if (isMounted.current) {
        await fetchList();
        closeModal();
      }
    } catch (e) {
      if (isMounted.current) {
        setModalError(e.message || 'Update failed');
      }
    } finally {
      if (isMounted.current) {
        setUpdatingId(null);
      }
    }
  };

  const openReviewModal = (row) => {
    setSelectedRequest(row);
    setExtendDueDate(false);
    setNewDueDate('');
    setModalError(null);
  };

  const closeModal = () => {
    if (updatingId) return;
    setSelectedRequest(null);
    setExtendDueDate(false);
    setNewDueDate('');
    setModalError(null);
  };

  const handleConfirmApprove = () => {
    if (!selectedRequest) return;
    if (extendDueDate && !newDueDate) {
      setModalError('Select a new due date or uncheck extend due date.');
      return;
    }
    const id = entryId(selectedRequest);
    const options = {};
    if (extendDueDate && newDueDate) {
      options.extendedDueDate = newDueDate;
    }
    updateStatus(id, 'Approved', options);
  };

  const handleReject = () => {
    if (!selectedRequest) return;
    updateStatus(entryId(selectedRequest), 'Rejected');
  };

  const entryId = (entry) => entry.documentId ?? entry.id ?? entry._id;

  const getDisplayValues = (entry) => {
    const attrs = entry.attributes || entry;
    const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
    const userAttrs = user.attributes ?? user;
    const course = attrs.course?.data ?? attrs.course ?? {};
    const courseAttrs = course.attributes ?? course;
    const userName = userAttrs.username ?? userAttrs.email ?? '—';
    const courseTitle = courseAttrs.title ?? '—';
    const statusRaw = attrs.request_status ?? entry.request_status ?? 'Pending';
    const statusVal = typeof statusRaw === 'string' ? statusRaw : 'Pending';
    return { userName, courseTitle, statusVal, attrs, userAttrs };
  };

  const filteredList = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    const status = (statusFilter || '').trim();
    const company = (companyFilter || '').trim();
    return list.filter((entry) => {
      const { userName, courseTitle, statusVal, attrs, userAttrs } = getDisplayValues(entry);
      const entryIdVal = entry.documentId ?? entry.id ?? entry._id;
      if (company) {
        const entryCompany = (attrs.company || userAttrs.company || '').toLowerCase();
        if (entryCompany !== company.toLowerCase()) return false;
      }
      if (status && statusVal !== status) return false;
      if (!q) return true;
      const matches = (
        (userName && userName.toLowerCase().includes(q)) ||
        (userAttrs.firstname && userAttrs.firstname.toLowerCase().includes(q)) ||
        (userAttrs.lastname && userAttrs.lastname.toLowerCase().includes(q)) ||
        (userAttrs.emp_code && String(userAttrs.emp_code).toLowerCase().includes(q)) ||
        (userAttrs.emp_id && String(userAttrs.emp_id).toLowerCase().includes(q)) ||
        (userAttrs.id && String(userAttrs.id).toLowerCase().includes(q)) ||
        (entryIdVal && String(entryIdVal).toLowerCase().includes(q))
      );
      if (company.toLowerCase() === 'aia' && /^\d+$/.test(q)) {
        return userAttrs.emp_code && String(userAttrs.emp_code).includes(q);
      } else if (company.toLowerCase() === 'vega' && /^emp\d+$/i.test(q)) {
        return userAttrs.emp_id && String(userAttrs.emp_id).toLowerCase().includes(q);
      }
      return matches || (courseTitle && courseTitle.toLowerCase().includes(q));
    });
  }, [list, search, statusFilter, companyFilter]);

  const totalFiltered = filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageList = filteredList.slice(start, start + pageSize);

  const modalDueInfo = selectedRequest ? getAssignmentDueInfo(selectedRequest) : null;
  const modalDisplay = selectedRequest ? getDisplayValues(selectedRequest) : null;
  const modalIdStr = selectedRequest ? String(entryId(selectedRequest) ?? '') : '';
  const isModalUpdating = updatingId === modalIdStr;
  const isModalPending = modalDisplay?.statusVal === 'Pending';

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
            <Flex gap={4} wrap="wrap" alignItems="flex-end">
              <Box style={{ minWidth: 140 }}>
                <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                  Company
                </Typography>
                <SingleSelect
                  value={companyFilter}
                  onChange={(v) => {
                    setCompanyFilter(String(v || ''));
                    setPage(1);
                  }}
                >
                  <SingleSelectOption value="">All Companies</SingleSelectOption>
                  <SingleSelectOption value="AIA">AIA</SingleSelectOption>
                  <SingleSelectOption value="Vega">Vega</SingleSelectOption>
                </SingleSelect>
              </Box>
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
                  placeholder={companyFilter.toLowerCase() === 'aia' ? 'Employee code (digits)' : companyFilter.toLowerCase() === 'vega' ? 'EMP ID (EMP12345)' : 'User, course, ID, etc.'}
                  style={{ ...INPUT_STYLE, maxWidth: '100%' }}
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
          </Box>

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
            <DataTable
              data={pageList}
              fullData={filteredList}
              paginatedData={pageList}
              columns={[
                {
                  key: 'id',
                  label: 'UserID',
                  render: (val, row) => {
                    const { userAttrs, attrs } = getDisplayValues(row);
                    const company = (attrs.company || userAttrs.company || '').toLowerCase();
                    if (company === 'aia') {
                      return <Typography variant="omega" style={TABLE_FONT_STYLE}>{userAttrs.emp_code || '—'}</Typography>;
                    } else if (company === 'vega') {
                      return <Typography variant="omega" style={TABLE_FONT_STYLE}>{userAttrs.emp_id || '—'}</Typography>;
                    }
                    return <Typography variant="omega" style={TABLE_FONT_STYLE}>—</Typography>;
                  },
                },
                { key: 'userName', label: 'User', render: (val, row) => <Typography variant="omega" style={TABLE_FONT_STYLE}>{getDisplayValues(row).userName}</Typography> },
                {
                  key: 'company',
                  label: 'Company',
                  render: (val, row) => {
                    const { userAttrs, attrs } = getDisplayValues(row);
                    return <Typography variant="omega" style={TABLE_FONT_STYLE}>{attrs.company || userAttrs.company || '—'}</Typography>;
                  },
                },
                { key: 'courseTitle', label: 'Course', render: (val, row) => <Typography variant="omega" style={TABLE_FONT_STYLE}>{getDisplayValues(row).courseTitle}</Typography> },
                // {
                //   key: 'due_date',
                //   label: 'Due date',
                //   render: (val, row) => (
                //     <Typography variant="omega" style={TABLE_FONT_STYLE}>
                //       {formatDisplayDate(getAssignmentDueInfo(row).due_date)}
                //     </Typography>
                //   ),
                // },
                { key: 'requested_for_attempt', label: 'Requested attempt', render: (val, row) => <Typography variant="omega" style={TABLE_FONT_STYLE}>{getDisplayValues(row).attrs.requested_for_attempt ?? '—'}</Typography> },
                {
                  key: 'statusVal',
                  label: 'Status',
                  render: (val, row) => {
                    const { statusVal } = getDisplayValues(row);
                    return (
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
                    );
                  },
                },
                {
                  key: 'actions',
                  label: 'Action',
                  render: (val, row) => {
                    const id = entryId(row);
                    const idStr = id != null ? String(id) : '';
                    const { statusVal } = getDisplayValues(row);
                    const isPending = statusVal === 'Pending';
                    const isUpdating = updatingId === idStr || updatingId === id;

                    if (!isPending) {
                      return (
                        <Typography variant="omega" textColor="neutral600" style={TABLE_FONT_STYLE}>
                          —
                        </Typography>
                      );
                    }

                    return (
                      <IconButton
                        onClick={() => openReviewModal(row)}
                        label="Review request"
                        disabled={isUpdating}
                        variant="ghost"
                      >
                        <Pencil />
                      </IconButton>
                    );
                  },
                },
              ]}
              pagination={{
                page: currentPage,
                pageSize: pageSize,
                total: totalFiltered,
                onPageChange: (p) => setPage(Number(p)),
                onPageSizeChange: (newSize) => {
                  setPageSize(Number(newSize));
                  setPage(1);
                },
              }}
              exportFileName={`quiz-reattempt-requests-${new Date().toISOString().split('T')[0]}.xlsx`}
              fontSize={TABLE_FONT_STYLE.fontSize}
            />
          )}

          {selectedRequest && modalDisplay && (
            <Modal.Root open={!!selectedRequest} onOpenChange={(open) => !open && closeModal()}>
              <Modal.Content style={{ maxWidth: '520px' }}>
                <Modal.Header>
                  <Modal.Title>Review reattempt request</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                  {modalError && (
                    <Box padding={3} background="danger100" hasRadius marginBottom={4}>
                      <Typography textColor="danger700" variant="pi">{modalError}</Typography>
                    </Box>
                  )}

                  <Box
                    padding={4}
                    background="neutral0"
                    hasRadius
                    borderColor="neutral200"
                    style={{ border: '1px solid #eaeaef' }}
                    marginBottom={4}
                  >
                    <Flex gap={4} wrap="wrap">
                      <Box style={{ flex: '1 1 200px' }}>
                        <DetailField label="User" value={modalDisplay.userName} />
                      </Box>
                      <Box style={{ flex: '1 1 200px' }}>
                        <DetailField label="Course" value={modalDisplay.courseTitle} />
                      </Box>
                      <Box style={{ flex: '1 1 140px' }}>
                        <DetailField label="Attempt" value={modalDisplay.attrs.requested_for_attempt ?? '—'} />
                      </Box>
                      <Box style={{ flex: '1 1 140px' }}>
                        <DetailField label="Status" value={modalDisplay.statusVal} />
                      </Box>
                    </Flex>
                  </Box>

                  <Box marginBottom={isModalPending && modalDueInfo?.due_date ? 4 : 0}>
                    <Typography variant="sigma" textColor="neutral600" marginBottom={3}>
                      Assignment due date
                    </Typography>
                    {modalDueInfo?.due_date ? (
                      <Box
                        padding={4}
                        background="neutral100"
                        hasRadius
                        style={{ border: '1px solid #eaeaef' }}
                      >
                        <Flex gap={2} alignItems="center" wrap="wrap" marginBottom={2}>
                          <Typography variant="omega" fontWeight="bold">
                            {formatDisplayDate(modalDueInfo.due_date)}
                          </Typography>
                          <br></br>
                          <Badge variant={dueStatusBadgeVariant(modalDueInfo.due_status)}>
                            {modalDueInfo.due_status_label}
                          </Badge>
                        </Flex>
                    
                      </Box>
                    ) : (
                      <Typography variant="pi" textColor="neutral600">
                        No matching course assignment found. Reattempt can still be approved; due date extension is unavailable.
                      </Typography>
                    )}
                  </Box>

                  {isModalPending && modalDueInfo?.due_date && (
                    <Box
                      paddingTop={4}
                      style={{ borderTop: '1px solid #eaeaef' }}
                    >
                      {/* <Typography variant="sigma" textColor="neutral600" marginBottom={3}>
                        Optional extension
                      </Typography> */}
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: extendDueDate ? 12 : 0 }}>
                        <input
                          type="checkbox"
                          checked={extendDueDate}
                          onChange={(e) => {
                            setExtendDueDate(e.target.checked);
                            if (!e.target.checked) setNewDueDate('');
                          }}
                          disabled={isModalUpdating}
                        />
                        <Typography variant="omega">Extend due date</Typography>
                      </label>
                      {extendDueDate && (
                        <Box paddingLeft={2}>
                          <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 6, display: 'block' }}>
                            New due date
                          </Typography>
                          <input
                            type="date"
                            value={newDueDate}
                            min={todayIsoDate()}
                            onChange={(e) => setNewDueDate(e.target.value)}
                            disabled={isModalUpdating}
                            style={INPUT_STYLE}
                          />
                          {modalDueInfo.affects_multiple_users && (
                            <Typography variant="pi" textColor="warning600" style={{ marginTop: 10, display: 'block' }}>
                              Applies to all {modalDueInfo.shared_user_count} users on this assignment.
                            </Typography>
                          )}
                          {(modalDueInfo.assignment_target_type === 'Department' || modalDueInfo.assignment_target_type === 'Location') && (
                            <Typography variant="pi" textColor="warning600" style={{ marginTop: 10, display: 'block' }}>
                              Applies to the entire {modalDueInfo.assignment_target_type.toLowerCase()} group.
                            </Typography>
                          )}
                        </Box>
                      )}
                    </Box>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Flex justifyContent="space-between" width="100%" alignItems="center">
                    <Box>
                      {isModalPending && (
                        <Button
                          variant="danger"
                          onClick={handleReject}
                          disabled={isModalUpdating}
                        >
                          Reject
                        </Button>
                      )}
                    </Box>
                    <Flex gap={2}>
                      <Button variant="tertiary" onClick={closeModal} disabled={isModalUpdating}>
                        Cancel
                      </Button>
                      {isModalPending && (
                        <Button
                          variant="default"
                          onClick={handleConfirmApprove}
                          disabled={isModalUpdating || (extendDueDate && !newDueDate)}
                        >
                          {extendDueDate ? 'Approve & extend' : 'Approve'}
                        </Button>
                      )}
                    </Flex>
                  </Flex>
                </Modal.Footer>
              </Modal.Content>
            </Modal.Root>
          )}
        </Box>
      </Layouts.Content>
    </Layouts.Root>
  );
}
