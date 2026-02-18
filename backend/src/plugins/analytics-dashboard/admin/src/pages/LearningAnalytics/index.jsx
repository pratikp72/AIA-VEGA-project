import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Layouts } from '@strapi/admin/strapi-admin';
import { Box, Flex, Typography, Loader, Button } from '@strapi/design-system';import * as XLSX from 'xlsx';import { useAnalytics } from '../../hooks/useAnalytics';
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
    // Additional filter states for Filters component
    const [filterStatus, setFilterStatus] = useState('');
    const [filterTimeMin, setFilterTimeMin] = useState('');
    const [filterTimeMax, setFilterTimeMax] = useState('');
  const { fetchLearningGlobal, fetchLearningPersonal, fetchLearningEmployeeTable, fetchDepartments } = useAnalytics();
  // Fetch all courses for dropdown
  const fetchAllCourses = async () => {
    try {
      const res = await fetch('/api/courses?pagination[limit]=1000');
      if (!res.ok) throw new Error('Failed to fetch courses');
      const json = await res.json();
      // Strapi v4: json.data is array of course objects
      setCourses(Array.isArray(json.data) ? json.data.map(c => ({
        id: c.id,
        title: c.attributes?.title || c.title || `Course ${c.id}`
      })) : []);
    } catch (err) {
      setCourses([]);
    }
  };
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
  const [filterCourse, setFilterCourse] = useState('');
  const [courses, setCourses] = useState([]);
  const searchTimeoutRef = useRef(null);

  const handleExportAllPersonalData = useCallback(() => {
    if (!data || !employeeDetail) return;

    // Create workbook with multiple sheets
    const wb = XLSX.utils.book_new();

    // Sheet 1: Employee Personal Details
    const employeeData = [{
      'Employee ID': employeeDetail.id ?? employeeId ?? '',
      'Name': employeeDetail.employee_name || employeeDetail.username || employeeDetail.name || '',
      'Email': employeeDetail.email ?? '',
      'Company': employeeDetail.company ?? '',
      'Department': employeeDetail.department?.name || employeeDetail.department || '',
    }];
    const ws1 = XLSX.utils.json_to_sheet(employeeData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Employee Details');

    // Sheet 2: My Course Progress
    const courseProgressData = (data.courseProgress || []).map((c) => ({
      'Course': c.courseTitle ?? '',
      'Category': c.courseCategory ?? '',
      'Status': c.status ?? '',
      'Progress %': c.percentage ?? '',
      'Time (min)': c.timeSpentMinutes ?? '',
      'Completed At': c.completedAt ?? '',
      'Certificate': c.certificateIssued ? 'Yes' : 'No',
    }));
    const ws2 = XLSX.utils.json_to_sheet(courseProgressData);
    XLSX.utils.book_append_sheet(wb, ws2, 'My Course Progress');

    // Sheet 3: Module Video Details
    const moduleVideoData = (data.moduleVideoProgress || []).map((m) => ({
      'Course': m.courseTitle ?? '',
      'Module': m.moduleTitle ?? '',
      'Completion Type': m.videoCompletionType ?? '',
      'Time Watched (min)': m.timeWatchedMinutes ?? '',
      'Video Duration (min)': m.videoDurationMinutes ?? '',
    }));
    const ws3 = XLSX.utils.json_to_sheet(moduleVideoData);
    XLSX.utils.book_append_sheet(wb, ws3, 'Module Video Details');

    // Download file
    const fileName = `learning-analytics-${employeeDetail.employee_name || employeeDetail.username || 'user'}-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }, [data, employeeDetail, employeeId]);

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
    fetchAllCourses();
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
    if (filterStatus) params.status = filterStatus;

    let fetcher;
    if (viewMode === 'table') {
      const searchVal = searchDebounced?.trim();
      const tableParams = {
        ...params,
        sortBy: 'courseCompletionTimeMinutes',
        sortOrder,
        page,
        pageSize,
        ...(searchVal && { search: searchVal }),
        ...(filterCourse && { courseId: filterCourse }),
        ...(filterStatus && { status: filterStatus }),
        ...(filterTimeMin && { filterTimeMin }),
        ...(filterTimeMax && { filterTimeMax }),
      };
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
  }, [viewMode, employeeId, dateFrom, dateTo, department, company, searchDebounced, sortOrder, page, pageSize, filterCourse]);

  useEffect(() => {
    if (viewMode === 'table') setPage(1);
  }, [viewMode, searchDebounced, company]);

  useEffect(() => {
    if (viewMode === 'personal' && employeeId) {
      setCourseProgressPage(1);
      setSelectedCourseForModules('');
    }
  }, [viewMode, employeeId]);

  // Default selected course for module video table to first enrolled course (use courseId when available)
  useEffect(() => {
    if (!data?.courseProgress?.length || viewMode !== 'personal') return;
    const first = data.courseProgress[0];
    const firstValue = first.courseId != null ? first.courseId : first.courseTitle;
    const matches = (c) => (c.courseId != null && c.courseId === selectedCourseForModules) || (c.courseTitle === selectedCourseForModules);
    if (selectedCourseForModules === '' || !data.courseProgress.some(matches)) {
      setSelectedCourseForModules(firstValue);
    }
  }, [data, viewMode, selectedCourseForModules]);

  useEffect(() => {
    if (viewMode === 'table' || viewMode === 'global' || (viewMode === 'personal' && employeeId)) {
      loadData();
    } else {
      setData(null);
      setLoading(false);
    }
  }, [viewMode, employeeId, dateFrom, dateTo, department, company, searchDebounced, sortOrder, page, pageSize, filterCourse, filterStatus, filterTimeMin, filterTimeMax]);

  const kpis = data?.kpis || {};
  const quiz = data?.quiz || {};
  const isPersonal = viewMode === 'personal';

  return (
    <>
      <Page.Title>Learning Analytics</Page.Title>
      <Page.Main>
      <Layouts.Header
        title="Learning Analytics"
        subtitle={isPersonal ? 'Personal learning metrics' : 'Content learning metrics'}
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
            filterCourse={filterCourse}
            setFilterCourse={setFilterCourse}
            courses={courses}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterTimeMin={filterTimeMin}
            setFilterTimeMin={setFilterTimeMin}
            filterTimeMax={filterTimeMax}
            setFilterTimeMax={setFilterTimeMax}
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
              {(() => {
                const rows = data.rows || [];
                const q = (search || '').toLowerCase().trim();
                let filtered = rows;
                // Filter by course enrollment if course filter is selected
                if (filterCourse) {
                  filtered = filtered.filter((row) => {
                    // Accept both Strapi v4 and custom backend shapes
                    // row.coursesEnrolledIds: array of course IDs
                    // row.coursesEnrolled: array of course objects or IDs
                    if (Array.isArray(row.coursesEnrolledIds)) {
                      return row.coursesEnrolledIds.includes(filterCourse);
                    }
                    if (Array.isArray(row.coursesEnrolled)) {
                      // Accept array of objects or IDs
                      return row.coursesEnrolled.some(c => {
                        if (typeof c === 'object') return String(c.id) === String(filterCourse);
                        return String(c) === String(filterCourse);
                      });
                    }
                    // fallback: if only count is available, skip filtering
                    return true;
                  });
                }
                if (q) {
                  // First, filter by name (flexible)
                  filtered = filtered.filter((row) => {
                    const name = (row.employeeName || '').toLowerCase();
                    return name.includes(q);
                  });
                  // If more than one match, try to further filter by emp_id/emp_code
                  if (filtered.length > 1) {
                    // Try to extract an emp_id or emp_code from the search string
                    const empCodeMatch = q.match(/\b\d{3,}\b/); // e.g. 12345
                    const empIdMatch = q.match(/emp\d{3,}/i); // e.g. EMP12345
                    if (empCodeMatch) {
                      filtered = filtered.filter((row) =>
                        (row.emp_code || '').toLowerCase().includes(empCodeMatch[0])
                      );
                    } else if (empIdMatch) {
                      filtered = filtered.filter((row) =>
                        (row.emp_id || '').toLowerCase().includes(empIdMatch[0].toLowerCase())
                      );
                    }
                  }
                }
                return (
                  <DataTable
                    data={filtered}
                    title="Employee Learning Summary"
                    exportFileName="employee-learning-summary.xlsx"
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
                      { key: 'progressPercent', label: 'Avg Progress %', render: (v) => `${v ?? 0}%` },
                      { key: 'avgScore', label: 'Avg Quiz Score' },
                      {
                        key: 'courseCompletionTimeMinutes',
                        label: 'Completion Time',
                        sortable: true,
                        render: (v) => {
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
                );
              })()}
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

              {/* Content view only: Status Distribution, Completion Trend, Category, Department */}
              {!isPersonal && (
                <>
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
                </>
              )}

              {/* Personal view: Course by category + Completion trend over time – always show so layout is visible */}
              {isPersonal && (
                <>
                  <Flex justifyContent="flex-end" marginBottom={4}>
                    <Button
                      variant="secondary"
                      size="M"
                      onClick={handleExportAllPersonalData}
                      disabled={!data?.courseProgress?.length || !employeeDetail}
                    >
                      Download 
                    </Button>
                  </Flex>
                  <Flex gap={4} marginBottom={6} wrap="wrap">
                    <Box style={{ flex: '1 1 350px', minWidth: 280 }}>
                      <BarChart
                        data={Array.isArray(data?.categoryDistribution) ? data.categoryDistribution : []}
                        title="Courses by Category"
                        nameKey="name"
                        dataKey="value"
                        height={260}
                      />
                    </Box>
                    <Box style={{ flex: '1 1 400px', minWidth: 320 }}>
                      <AreaChart
                        data={Array.isArray(data?.monthlyCompletions) ? data.monthlyCompletions : []}
                        title="Completion Trend Over Time"
                        nameKey="month"
                        dataKey="value"
                        height={260}
                      />
                    </Box>
                  </Flex>

                  {/* Course Progress Table (Personal) – show table or placeholder */}
                  {data?.courseProgress && data.courseProgress.length > 0 ? (() => {
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
                  })() : (
                    <Box marginBottom={6} padding={6} background="neutral100" hasRadius>
                      <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 8 }}>My Course Progress</Typography>
                      <Typography textColor="neutral600">No course progress data for this employee yet.</Typography>
                    </Box>
                  )}

                  {/* Module video details by course (Personal) – course dropdown + table or placeholder */}
                  {data?.courseProgress && data.courseProgress.length > 0 ? (
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
                        {data.courseProgress.map((c) => {
                          const value = c.courseId != null ? c.courseId : c.courseTitle;
                          return (
                            <option key={value} value={value}>
                              {c.courseTitle}
                            </option>
                          );
                        })}
                      </select>
                    </Flex>
                  </Flex>
                  {selectedCourseForModules ? (() => {
                    const moduleVideoProgress = data.moduleVideoProgress || [];
                    const rows = moduleVideoProgress.filter((p) =>
                      (p.courseId != null && p.courseId === selectedCourseForModules) ||
                      (p.courseId == null && p.courseTitle === selectedCourseForModules)
                    );
                    const selectedCourseLabel = data.courseProgress?.find((c) => {
                      const v = c.courseId != null ? c.courseId : c.courseTitle;
                      return v === selectedCourseForModules;
                    })?.courseTitle || selectedCourseForModules;
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
                            title={`Modules: ${selectedCourseLabel}`}
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
                            title={`Module video completion for ${selectedCourseLabel}`}
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
              ) : (
                <Box marginBottom={6} padding={6} background="neutral100" hasRadius>
                  <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 8 }}>Module video details</Typography>
                  <Typography textColor="neutral600">No course progress – complete a course to see module details.</Typography>
                </Box>
              )}
                </>
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