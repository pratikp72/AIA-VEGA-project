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
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';
import DateRangeInput from '../../../../analytics-dashboard/admin/src/components/DateRangeInput';

const DEFAULT_PAGE_SIZE = 10;
const TABLE_FONT_STYLE = { fontSize: '14px' };
const COMPANY_OPTIONS = [
  { value: '', label: 'All Companies' },
  { value: 'AIA', label: 'AIA' },
  { value: 'VEGA', label: 'VEGA' },
];

export default function ProfileEditRequestsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  
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
    const reason = attrs.reason ?? entry.reason ?? '—';
    const requestedChanges = attrs.requested_changes ?? entry.requested_changes ?? {};
    // Prefer company from user, fallback to company on request
    const userCompany = userAttrs.company || attrs.company || attrs.companyName || '';
      return { userName, userId, reason, requestedChanges, attrs, userCompany };
  };

  const filteredList = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    const company = (companyFilter || '').trim();
    return list.filter((entry) => {
      const { userName, statusVal, userCompany, attrs } = getDisplayValues(entry);
        if (company && userCompany && userCompany.toLowerCase() !== company.toLowerCase()) return false;
        if (company && !userCompany) return false;
        if (dateRange && dateRange.start && attrs.createdAt && new Date(attrs.createdAt) < dateRange.start) return false;
        if (dateRange && dateRange.end && attrs.createdAt && new Date(attrs.createdAt) > dateRange.end) return false;
        if (!q) return true;
        return (userName && userName.toLowerCase().includes(q));
    });
  }, [list, search, companyFilter, dateRange]);

  const totalFiltered = filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageList = filteredList.slice(start, start + pageSize);

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

    // Get old values from selectedRequest's user (if available)
    // Support both Strapi v4 (with .data/.attributes) and flat populated object
    let user = {};
    if (selectedRequest?.attributes?.users_permissions_user?.data?.attributes) {
      user = selectedRequest.attributes.users_permissions_user.data.attributes;
    } else if (selectedRequest?.users_permissions_user?.attributes) {
      user = selectedRequest.users_permissions_user.attributes;
    } else if (selectedRequest?.users_permissions_user) {
      user = selectedRequest.users_permissions_user;
    }
    // Debug: print user object to console
    console.log('User object for changes dialog:', user);

    // Helper to get old value with fallback for common aliases
    const getOldValue = (field) => {
      if (user[field] !== undefined) return user[field];
      if (field === 'name' && user.employee_name !== undefined) return user.employee_name;
      if (field === 'employee_name' && user.name !== undefined) return user.name;
      if (field === 'ext' && user.extension !== undefined) return user.extension;
      if (field === 'branch' && user.branch !== undefined) return user.branch;
      return undefined;
    };

    return (
      <Box>
        {Object.entries(requestedChanges).map(([field, newValue]) => {
          const oldValue = getOldValue(field);
          console.log('Field:', field, 'New:', newValue, 'Old:', oldValue, 'User:', user);
          return (
            <Flex key={field} padding={2} background="neutral100" marginBottom={2} hasRadius>
              <Box style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                <Typography variant="pi" fontWeight="bold" style={{ minWidth: 80 }}>{field}:</Typography>
                {oldValue !== undefined ? (
                  <>
                    <Typography variant="omega" style={{ marginLeft: 8, textDecoration: 'line-through' }}>
                      {typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue)}
                    </Typography>
                    <Typography variant="omega" style={{ margin: '0 8px' }}>
                      &rarr;
                    </Typography>
                    <Typography variant="omega" style={{ fontWeight: 'bold' }}>
                      {typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue)}
                    </Typography>
                  </>
                ) : (
                  <Typography variant="omega" style={{ marginLeft: 8 }}>
                    {typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue)}
                  </Typography>
                )}
              </Box>
            </Flex>
          );
        })}
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
        {/* Unified filter card */}
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
            <Box style={{ minWidth: 160 }}>
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
                {COMPANY_OPTIONS.map((opt) => (
                  <SingleSelectOption key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Box>
            <Box style={{ minWidth: 260 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                Date Range
              </Typography>
              <DateRangeInput
                value={dateRange}
                onChange={({ start, end }) => {
                  setDateRange({ start, end });
                  setPage(1);
                }}
              />
            </Box>
          </Flex>
        </Box>

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
            {/* <Box background="neutral0" hasRadius shadow="tableShadow" padding={6}> */}
              <DataTable
                data={pageList}
                columns={[
                  { key: 'userName', label: 'Employee' },
                  { key: 'userId', label: 'User ID' },
                  { key: 'reason', label: 'Reason' },
                  { key: 'changes', label: 'Changes', render: (val, row) => (
                    <Button size="S" variant="tertiary" onClick={() => viewChanges(row)}>
                      View 
                    </Button>
                  ) },
                  { key: 'company', label: 'Company', render: (val, row) => (row?.userCompany || '—') },
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
                exportFileName={`profile-edit-requests-${new Date().toISOString().split('T')[0]}.xlsx`}
                fontSize={TABLE_FONT_STYLE.fontSize}
              />

              {/* Pagination removed as requested */}
            {/* </Box> */}
          </>
        )}

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