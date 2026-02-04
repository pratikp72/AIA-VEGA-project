import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Layouts } from '@strapi/admin/strapi-admin';
import { Box, Flex, Typography, Loader, Button } from '@strapi/design-system';
import { useAnalytics } from '../../hooks/useAnalytics';
import { StatCard } from '../../components/StatCard';
import { DonutChart } from '../../components/DonutChart';
import { BarChart } from '../../components/BarChart';
import { LineChart } from '../../components/LineChart';
import { AreaChart } from '../../components/AreaChart';
import { DataTable } from '../../components/DataTable';
import { Filters } from '../../components/Filters';
import { EmployeeSearch } from '../../components/EmployeeSearch';
import { EmployeeDetailCard } from '../../components/EmployeeDetailCard';

export default function LearningAnalyticsPage() {
  const { fetchLearningGlobal, fetchLearningPersonal, fetchLearningEmployeeTable, exportLearningEmployeeTable, fetchDepartments } = useAnalytics();
  const [viewMode, setViewMode] = useState('global');
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [department, setDepartment] = useState('');
  const [company, setCompany] = useState('');
  const [employeeId, setEmployeeId] = useState(null);
  const [employeeDetail, setEmployeeDetail] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Employee Table specific
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [courseProgressPage, setCourseProgressPage] = useState(1);
  const [courseProgressPageSize, setCourseProgressPageSize] = useState(10);
  const [moduleVideoPage, setModuleVideoPage] = useState(1);
  const [moduleVideoPageSize, setModuleVideoPageSize] = useState(10);
  const [selectedCourseForModules, setSelectedCourseForModules] = useState('');
  const [exporting, setExporting] = useState(false);
  const searchTimeoutRef = useRef(null);

  useEffect(() => {
    if (viewMode !== 'table') return;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setSearchDebounced(search);
    }, 400);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search, viewMode]);

  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, []);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = {};
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (viewMode === 'global') {
      if (department) params.department = department;
    }
    if (company) params.company = company;

    let fetcher;
    if (viewMode === 'table') {
      const tableParams = {
        ...params,
        sortBy: 'courseCompletionTimeMinutes',
        sortOrder,
        page,
        pageSize,
      };
      const searchVal = searchDebounced?.trim();
      if (searchVal) tableParams.search = searchVal;
      fetcher = () => fetchLearningEmployeeTable(tableParams);
    } else if (viewMode === 'personal' && employeeId) {
      fetcher = () => fetchLearningPersonal({ ...params, userId: employeeId });
    } else {
      fetcher = () => fetchLearningGlobal(params);
    }

    fetcher()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [viewMode, employeeId, dateFrom, dateTo, department, company, searchDebounced, sortOrder, page, pageSize]);

  useEffect(() => {
    if (viewMode === 'table') setPage(1);
  }, [viewMode, searchDebounced, company]);

  useEffect(() => {
    if (viewMode === 'personal' && employeeId) {
      setCourseProgressPage(1);
      setSelectedCourseForModules('');
    }
  }, [viewMode, employeeId]);

  // Default selected course for module video table to first enrolled course
  useEffect(() => {
    if (!data?.courseProgress?.length || viewMode !== 'personal') return;
    if (selectedCourseForModules === '' || !data.courseProgress.some((c) => c.courseTitle === selectedCourseForModules)) {
      setSelectedCourseForModules(data.courseProgress[0].courseTitle);
    }
  }, [data, viewMode, selectedCourseForModules]);

  useEffect(() => {
    if (viewMode === 'table' || viewMode === 'global' || (viewMode === 'personal' && employeeId)) {
      loadData();
    } else {
      setData(null);
      setLoading(false);
    }
  }, [viewMode, employeeId, dateFrom, dateTo, department, company, searchDebounced, sortOrder, page, pageSize]);

  const kpis = data?.kpis || {};
  const quiz = data?.quiz || {};
  const isPersonal = viewMode === 'personal';

  return (
    <>
      <Page.Title>Learning Analytics</Page.Title>
      <Page.Main>
      <Layouts.Header
        title="Learning Analytics"
        subtitle={isPersonal ? 'Personal learning metrics' : 'Global learning metrics'}
        as="h2"
      />
      <Layouts.Content>
        <Box paddingLeft={8} paddingRight={8} paddingTop={6} paddingBottom={8}>
          <Filters
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            department={department}
            onDepartmentChange={setDepartment}
            departments={departments}
            company={company}
            onCompanyChange={setCompany}
            showEmployeeSelector
            showEmployeeTable
            search={search}
            onSearchChange={setSearch}
          >
            <EmployeeSearch value={employeeId} onChange={setEmployeeId} onEmployeeFound={setEmployeeDetail} />
          </Filters>

          {loading && (
            <Flex justifyContent="center" padding={8}>
              <Loader>Loading analytics...</Loader>
            </Flex>
          )}

          {error && (
            <Box padding={4} background="danger100" hasRadius marginBottom={4}>
              <Typography textColor="danger700">{error}</Typography>
            </Box>
          )}

          {!loading && data && viewMode === 'table' && (
            <Box marginBottom={6}>
              <Flex justifyContent="flex-end" marginBottom={3}>
                <Button
                  variant="secondary"
                  size="S"
                  loading={exporting}
                  disabled={exporting}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      const params = {};
                      if (dateFrom) params.dateFrom = dateFrom;
                      if (dateTo) params.dateTo = dateTo;
                      if (company) params.company = company;
                      if (searchDebounced?.trim()) params.search = searchDebounced.trim();
                      params.sortBy = 'courseCompletionTimeMinutes';
                      params.sortOrder = sortOrder;
                      await exportLearningEmployeeTable(params);
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  Download
                </Button>
              </Flex>
              <DataTable
                data={data.rows || []}
                title="Employee Learning Summary"
                pagination={
                  data.total != null && data.total > 0
                    ? {
                        page: data.page || 1,
                        pageSize: data.pageSize || 10,
                        total: data.total,
                        onPageChange: setPage,
                        onPageSizeChange: (v) => {
                          setPageSize(Number(v));
                          setPage(1);
                        },
                      }
                    : null
                }
                sortBy="courseCompletionTimeMinutes"
                sortOrder={sortOrder}
                onSortChange={(_, order) => {
                  setSortOrder(order);
                  setPage(1);
                }}
                fontSize="16px"
                columns={[
                  { key: 'employeeName', label: 'Employee Name' },
                  { key: 'company', label: 'Company' },
                  { key: 'coursesEnrolled', label: 'Courses Enrolled' },
                  { key: 'totalModulesDone', label: 'Total Modules Done' },
                  {
                    key: 'progressPercent',
                    label: 'Progress %',
                    render: (v) => `${v ?? 0}%`,
                  },
                  { key: 'avgScore', label: 'Avg Quiz Score' },
                  {
                    key: 'courseCompletionTimeMinutes',
                    label: 'Course Completion Time',
                    sortable: true,
                    render: (v) => {
                      if (v == null || v === '') return '—';
                      const m = Number(v);
                      if (Number.isNaN(m) || m < 0) return '—';
                      const h = Math.floor(m / 60);
                      const min = m % 60;
                      if (h === 0) return `${min}m`;
                      if (min === 0) return `${h}h`;
                      return `${h}h${min}m`;
                    },
                  },
                ]}
              />
            </Box>
          )}

          {!loading && data && viewMode !== 'table' && (
            <>
              {isPersonal && employeeDetail && (
                <EmployeeDetailCard employee={employeeDetail} />
              )}
              {/* KPIs */}
              <Flex gap={4} marginBottom={6} wrap="wrap">
                <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                  <StatCard
                    label={isPersonal ? 'Total Courses' : 'Total Progress Records'}
                    value={kpis.totalAssignments ?? kpis.totalCourses}
                    colorIndex={0}
                  />
                </Box>
                <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                  <StatCard label="Completion Rate" value={`${kpis.completionRate ?? 0}%`} colorIndex={1} />
                </Box>
                <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                  <StatCard
                    label="Avg Time Spent"
                    value={`${kpis.avgTimeSpentMinutes ?? 0} min`}
                    subtext="per course"
                    colorIndex={2}
                  />
                </Box>
                <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                  <StatCard
                    label={isPersonal ? 'Certificates Earned' : 'Completed with Certificate'}
                    value={kpis.certificatesIssued ?? kpis.certificatesEarned ?? 0}
                    colorIndex={3}
                  />
                </Box>
              </Flex>

              {/* Quiz Stats (when available) */}
              {(quiz.passRate !== undefined || quiz.avgScore !== undefined) && (
                <Flex gap={4} marginBottom={6} wrap="wrap">
                  <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                    <StatCard label="Quiz Pass Rate" value={`${quiz.passRate ?? 0}%`} colorIndex={4} />
                  </Box>
                  <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                    <StatCard label="Quiz Avg Score" value={quiz.avgScore ?? 0} colorIndex={5} />
                  </Box>
                </Flex>
              )}

              {/* Charts Row 1 */}
              <Flex gap={4} marginBottom={6} wrap="wrap">
                <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
                  <DonutChart
                    data={data.statusDistribution}
                    title="Course Status Distribution"
                    height={260}
                  />
                </Box>
                <Box style={{ flex: '1 1 400px', minWidth: 320 }}>
                  <AreaChart
                    data={data.monthlyCompletions}
                    title="Completion Trend Over Time"
                    nameKey="month"
                    dataKey="value"
                    height={260}
                  />
                </Box>
              </Flex>

              {/* Charts Row 2 */}
              <Flex gap={4} marginBottom={6} wrap="wrap">
                <Box style={{ flex: '1 1 350px', minWidth: 280 }}>
                  <BarChart
                    data={data.categoryDistribution}
                    title="Courses by Category"
                    nameKey="name"
                    dataKey="value"
                    height={260}
                  />
                </Box>
                <Box style={{ flex: '1 1 350px', minWidth: 280 }}>
                  <BarChart
                    data={data.departmentDistribution}
                    title="Course Progress by Department"
                    nameKey="name"
                    dataKey="value"
                    height={260}
                  />
                </Box>
              </Flex>

              {/* Module video completion – horizontal bar chart (Personal only) – dedicated row so it’s always visible */}
              {/* Course Progress Table (Personal only) */}
              {isPersonal && data.courseProgress && data.courseProgress.length > 0 && (() => {
                const total = data.courseProgress.length;
                const start = (courseProgressPage - 1) * courseProgressPageSize;
                const paginatedData = data.courseProgress.slice(start, start + courseProgressPageSize);
                return (
                  <Box marginBottom={6}>
                    <DataTable
                      data={paginatedData}
                      title="My Course Progress"
                      fontSize="16px"
                      pagination={{
                        page: courseProgressPage,
                        pageSize: courseProgressPageSize,
                        total,
                        onPageChange: setCourseProgressPage,
                        onPageSizeChange: (v) => {
                          setCourseProgressPageSize(Number(v));
                          setCourseProgressPage(1);
                        },
                      }}
                      columns={[
                        { key: 'courseTitle', label: 'Course' },
                        { key: 'courseCategory', label: 'Category' },
                        { key: 'status', label: 'Status' },
                        { key: 'percentage', label: 'Progress %', render: (v) => `${v}%` },
                        { key: 'timeSpentMinutes', label: 'Time (min)' },
                        {
                          key: 'certificateIssued',
                          label: 'Certificate',
                          render: (v) => (v ? 'Yes' : 'No'),
                        },
                      ]}
                    />
                  </Box>
                );
              })()}

              {/* Module video details by course (Personal only) – course dropdown + table */}
              {isPersonal && data.courseProgress && data.courseProgress.length > 0 && (
                <Box marginBottom={6}>
                  <Flex justifyContent="space-between" alignItems="center" marginBottom={4} wrap="wrap" gap={2}>
                    <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold">
                      Module video details
                    </Typography>
                    <Flex alignItems="center" gap={2}>
                      <Typography variant="pi" textColor="neutral600">Course:</Typography>
                      <select
                        value={selectedCourseForModules}
                        onChange={(e) => {
                          setSelectedCourseForModules(e.target.value);
                          setModuleVideoPage(1);
                        }}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #dcdce4',
                          borderRadius: '4px',
                          fontSize: '14px',
                          minWidth: 200,
                        }}
                      >
                        {data.courseProgress.map((c) => (
                          <option key={c.courseTitle} value={c.courseTitle}>
                            {c.courseTitle}
                          </option>
                        ))}
                      </select>
                    </Flex>
                  </Flex>
                  {selectedCourseForModules ? (() => {
                    const moduleVideoProgress = data.moduleVideoProgress || [];
                    const rows = moduleVideoProgress.filter((p) => p.courseTitle === selectedCourseForModules);
                    const formatCompletionType = (v) => {
                      if (!v) return '—';
                      const labels = { full_watch: 'Watched fully', skipped_to_end: 'Skipped to end', in_progress: 'In progress', not_started: 'Not started' };
                      return labels[v] || v;
                    };
                    const counts = { full_watch: 0, skipped_to_end: 0, in_progress: 0, not_started: 0 };
                    rows.forEach((r) => {
                      const t = r.videoCompletionType || 'not_started';
                      if (t in counts) counts[t] += 1;
                    });
                    return (
                      <>
                        {rows.length === 0 ? (
                          <Box padding={6} background="neutral100" hasRadius>
                            <Typography textColor="neutral600">
                              No module video data for this course yet.
                            </Typography>
                          </Box>
                        ) : (
                          <DataTable
                            data={rows.slice(
                              (moduleVideoPage - 1) * moduleVideoPageSize,
                              (moduleVideoPage - 1) * moduleVideoPageSize + moduleVideoPageSize
                            )}
                            title={`Modules: ${selectedCourseForModules}`}
                            fontSize="16px"
                            pagination={{
                              page: moduleVideoPage,
                              pageSize: moduleVideoPageSize,
                              total: rows.length,
                              onPageChange: setModuleVideoPage,
                              onPageSizeChange: (v) => {
                                setModuleVideoPageSize(Number(v));
                                setModuleVideoPage(1);
                              },
                            }}
                            columns={[
                              { key: 'moduleTitle', label: 'Module' },
                              {
                                key: 'videoCompletionType',
                                label: 'Video completion',
                                render: formatCompletionType,
                              },
                              {
                                key: 'timeWatchedMinutes',
                                label: 'Time watched (min)',
                                render: (v) => (v != null ? v : '—'),
                              },
                              {
                                key: 'videoDurationMinutes',
                                label: 'Video duration (min)',
                                render: (v) => (v != null ? v : '—'),
                              },
                            ]}
                          />
                        )}
                        <Box marginTop={4}>
                          <AreaChart
                            data={[
                              { name: 'Watched fully', value: counts.full_watch },
                              { name: 'Skipped to end', value: counts.skipped_to_end },
                              { name: 'In progress', value: counts.in_progress },
                              { name: 'Not started', value: counts.not_started },
                            ]}
                            title={`Module video completion for ${selectedCourseForModules}`}
                            nameKey="name"
                            dataKey="value"
                            height={220}
                          />
                        </Box>
                      </>
                    );
                  })() : (
                    <Box padding={6} background="neutral100" hasRadius>
                      <Typography textColor="neutral600">
                        Select a course to see module video details.
                      </Typography>
                    </Box>
                  )}
                </Box>
              )}
            </>
          )}

          {!loading && !data && viewMode === 'table' && (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">
                No employees found. Try adjusting filters or search.
              </Typography>
            </Box>
          )}

          {!loading && !data && viewMode === 'personal' && !employeeId && (
            <Box padding={6} background="neutral100" hasRadius>
              <Typography textColor="neutral600">
                Search for an employee by ID or email to view personal learning analytics.
              </Typography>
            </Box>
          )}
        </Box>
      </Layouts.Content>
    </Page.Main>
    </>
  );
}
