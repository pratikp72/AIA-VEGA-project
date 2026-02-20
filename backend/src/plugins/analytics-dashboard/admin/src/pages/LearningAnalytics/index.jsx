import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Layouts } from '@strapi/admin/strapi-admin';
import { Box, Flex, Typography, Loader, Button } from '@strapi/design-system';import * as XLSX from 'xlsx';import { useAnalytics } from '../../hooks/useAnalytics';
import { StatCard } from '../../components/StatCard';
import { DonutChart } from '../../components/DonutChart';
import { BarChart } from '../../components/BarChart';
import { LineChart } from '../../components/LineChart';
import { AreaChart } from '../../components/AreaChart';
import { FunnelChart } from '../../components/FunnelChart';
import { DataTable } from '../../components/DataTable';
import { Filters } from '../../components/Filters';
import { EmployeeSearch } from '../../components/EmployeeSearch';
import { EmployeeDetailCard } from '../../components/EmployeeDetailCard';

const dedupeList = (arr) => (Array.isArray(arr) ? arr.filter((x, i, a) => a.findIndex((y) => String(y?.id ?? y) === String(x?.id ?? x)) === i) : []);

export default function LearningAnalyticsPage() {
  const [viewMode, setViewMode] = useState('global');
  const [courseContentViewType, setCourseContentViewType] = useState('statistics');
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
  const [filterCourseCategory, setFilterCourseCategory] = useState('');
  const [unitLocation, setUnitLocation] = useState('');
  const [unitLocations, setUnitLocations] = useState([]);
  const [filterQuizStatus, setFilterQuizStatus] = useState('');
  const [filterFeedbackGiven, setFilterFeedbackGiven] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [courseModules, setCourseModules] = useState([]);
  const searchTimeoutRef = useRef(null);

  const { fetchLearningGlobal, fetchLearningPersonal, fetchLearningEmployeeTable, fetchDepartments, fetchUnitLocations, fetchCoursesByDepartment, fetchCourseModules } = useAnalytics();

  const moduleOptions = React.useMemo(() => {
    return (courseModules || []).map((m) => ({ value: m.title, label: m.title }));
  }, [courseModules]);

  useEffect(() => {
    if (!filterCourse) {
      setCourseModules([]);
      setFilterModule('');
      return;
    }
    fetchCourseModules(filterCourse)
      .then((list) => setCourseModules(Array.isArray(list) ? list : []))
      .catch(() => setCourseModules([]));
  }, [filterCourse, fetchCourseModules]);

  useEffect(() => {
    if (viewMode === 'personal') {
      if (company) {
        fetchCoursesByDepartment('', company).then(setCourses).catch(() => setCourses([]));
      } else {
        fetchAllCourses();
      }
    }
  }, [viewMode, company, fetchCoursesByDepartment]);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterTimeMin, setFilterTimeMin] = useState('');
  const [filterTimeMax, setFilterTimeMax] = useState('');
  // Fetch all courses for dropdown (when no department selected)
  const fetchAllCourses = async () => {
    try {
      const res = await fetch('/api/courses?pagination[limit]=1000');
      if (!res.ok) throw new Error('Failed to fetch courses');
      const json = await res.json();
      setCourses(Array.isArray(json.data) ? json.data.map(c => ({
        id: c.id,
        title: c.attributes?.title || c.title || `Course ${c.id}`
      })) : []);
    } catch (err) {
      setCourses([]);
    }
  };
  const handleExportAllPersonalData = useCallback(() => {
    if (!data || !employeeDetail) return;
    const wb = XLSX.utils.book_new();
    const employeeData = [{
      'Employee ID': employeeDetail.id ?? employeeId ?? '',
      'Name': employeeDetail.employee_name || employeeDetail.username || employeeDetail.name || '',
      'Email': employeeDetail.email ?? '',
      'Company': employeeDetail.company ?? '',
      'Department': employeeDetail.department?.name || employeeDetail.department || '',
    }];
    const ws1 = XLSX.utils.json_to_sheet(employeeData);
    XLSX.utils.book_append_sheet(wb, ws1, 'Employee Details');
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
    const moduleVideoData = (data.moduleVideoProgress || []).map((m) => ({
      'Course': m.courseTitle ?? '',
      'Module': m.moduleTitle ?? '',
      'Completion Type': m.videoCompletionType ?? '',
      'Time Watched (min)': m.timeWatchedMinutes ?? '',
      'Video Duration (min)': m.videoDurationMinutes ?? '',
    }));
    const ws3 = XLSX.utils.json_to_sheet(moduleVideoData);
    XLSX.utils.book_append_sheet(wb, ws3, 'Module Video Details');
    XLSX.writeFile(wb, 'learning-personal.xlsx');
  }, [data, employeeDetail, employeeId]);

  useEffect(() => {
    if (company) {
      fetchDepartments(company).then((data) => setDepartments(dedupeList(data || []))).catch(() => setDepartments([]));
      fetchUnitLocations(company).then((data) => setUnitLocations(dedupeList(data || []))).catch(() => setUnitLocations([]));
      fetchCoursesByDepartment('', company).then(setCourses).catch(() => setCourses([]));
    } else {
      fetchDepartments().then((data) => setDepartments(dedupeList(data || []))).catch(() => setDepartments([]));
      fetchUnitLocations().then((data) => setUnitLocations(dedupeList(data || []))).catch(() => setUnitLocations([]));
      fetchAllCourses();
    }
  }, [company, dedupeList]);

  // When department changes (content view): fetch courses for that department (and company if set), or company's courses, or all
  useEffect(() => {
    if (viewMode !== 'global') return;
    setFilterCourse('');
    if (department) {
      fetchCoursesByDepartment(department, company || '').then(setCourses).catch(() => setCourses([]));
    } else if (company) {
      fetchCoursesByDepartment('', company).then(setCourses).catch(() => setCourses([]));
    } else {
      fetchAllCourses();
    }
  }, [department, company, viewMode]);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = {};
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (viewMode === 'global') {
      if (department) params.department = department;
      if (filterCourse) {
        params.courseId = filterCourse;
        if (filterQuizStatus) params.quizStatus = filterQuizStatus;
        if (filterFeedbackGiven) params.feedbackGiven = filterFeedbackGiven;
        if (filterModule) params.moduleTitle = filterModule;
      }
      if (filterCourseCategory) params.courseCategory = filterCourseCategory;
      if (unitLocation) params.unitLocation = unitLocation;
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
  }, [viewMode, employeeId, dateFrom, dateTo, department, company, searchDebounced, sortOrder, page, pageSize, filterCourse, filterModule, filterStatus, filterTimeMin, filterTimeMax, filterCourseCategory, unitLocation, filterQuizStatus, filterFeedbackGiven]);

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
  }, [viewMode, employeeId, dateFrom, dateTo, department, company, searchDebounced, sortOrder, page, pageSize, filterCourse, filterModule, filterStatus, filterTimeMin, filterTimeMax, filterCourseCategory, unitLocation, filterQuizStatus, filterFeedbackGiven]);

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
            filterModule={filterModule}
            setFilterModule={setFilterModule}
            moduleOptions={moduleOptions}
            courses={courses}
            filterStatus={filterStatus}
            setFilterStatus={setFilterStatus}
            filterTimeMin={filterTimeMin}
            setFilterTimeMin={setFilterTimeMin}
            filterTimeMax={filterTimeMax}
            setFilterTimeMax={setFilterTimeMax}
            filterCourseCategory={filterCourseCategory}
            setFilterCourseCategory={setFilterCourseCategory}
            unitLocation={unitLocation}
            onUnitLocationChange={setUnitLocation}
            unitLocations={unitLocations}
            filterQuizStatus={filterQuizStatus}
            setFilterQuizStatus={setFilterQuizStatus}
            filterFeedbackGiven={filterFeedbackGiven}
            setFilterFeedbackGiven={setFilterFeedbackGiven}
          >
            <EmployeeSearch value={employeeId} onChange={setEmployeeId} onEmployeeFound={setEmployeeDetail} company={company} />
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
              {/* Course view: toggle Statistics (charts) vs Table */}
              {viewMode === 'global' && (
                <Flex marginBottom={4} alignItems="center" gap={2}>
                  <Typography variant="pi" textColor="neutral700" fontWeight="semiBold">View:</Typography>
                  <select
                    value={courseContentViewType}
                    onChange={(e) => setCourseContentViewType(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      border: '1px solid #dcdce4',
                      borderRadius: '4px',
                      fontSize: '14px',
                      minWidth: 180,
                    }}
                  >
                    <option value="statistics">Statistics view</option>
                    <option value="table">Table view</option>
                  </select>
                </Flex>
              )}
              {/* KPI cards: hide when Personal + module selected (only tables shown) */}
              {!(isPersonal && filterModule) && (
              <Flex gap={4} marginBottom={6} wrap="wrap">
                {isPersonal ? (
                  <>
                    {/* 1. Employee detail is shown above via EmployeeDetailCard */}
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Total Course Assigned" value={kpis.totalCourses ?? 0} colorIndex={0} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Total Course Completed" value={kpis.completedCourses ?? kpis.completedCourse ?? 0} colorIndex={1} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Avg Time Spent / Course" value={`${kpis.avgTimeSpentPerCourse ?? kpis.avgTimeSpentMinutes ?? 0} min`} colorIndex={2} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Certificates Earned" value={kpis.certificatesEarned ?? 0} colorIndex={3} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Quiz Pass Rate" value={`${kpis.quizPassRate ?? 0}%`} colorIndex={4} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Avg Quiz Score" value={kpis.avgQuizScore ?? quiz?.avgScore ?? 0} colorIndex={5} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Courses In Progress" value={kpis.coursesInProgress ?? 0} colorIndex={6} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Last Course Viewed" value={kpis.lastCourseViewed?.courseTitle ?? '—'} subtext={kpis.lastCourseViewed?.lastAccessedAt ? `at ${kpis.lastCourseViewed.lastAccessedAt}` : undefined} colorIndex={7} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Last Course Completed" value={kpis.lastCourseCompleted?.courseTitle ?? '—'} subtext={kpis.lastCourseCompleted?.completedAt ? `at ${kpis.lastCourseCompleted.completedAt}` : undefined} colorIndex={8} />
                    </Box>
                  </>
                ) : (
                  <>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Total Course" value={kpis.totalCourses ?? 0} colorIndex={0} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Total Enrollment" value={kpis.totalEnrollments ?? kpis.totalAssignments ?? 0} colorIndex={1} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Completion Rate" value={`${kpis.completionRate ?? 0}%`} colorIndex={2} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Avg Learning Time" value={`${kpis.avgTimeSpentMinutes ?? 0} min`} subtext="per enrollment" colorIndex={2} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Avg Quiz Score" value={kpis.avgQuizScore ?? quiz?.avgScore ?? 0} colorIndex={3} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Drop Off Rate" value={`${kpis.dropOffRate ?? 0}%`} subtext={kpis.dropOffCount != null ? `${kpis.dropOffCount} enrollments inactive 14+ days` : undefined} colorIndex={4} />
                    </Box>
                    <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
                      <StatCard label="Completed Course" value={kpis.completedCourse ?? 0} colorIndex={5} />
                    </Box>
                  </>
                )}
                {/* Personal view only: new KPIs */}
              </Flex>
              )}

              {/* Content view only: Statistics (charts) or Table view */}
              {!isPersonal && (
                <>
                  {courseContentViewType === 'statistics' && (
                    <>
                      <Box style={{ width: '100%', marginBottom: 24 }}>
                        <LineChart
                          data={data.learningActivityByWeek || []}
                          title="Learning Activity"
                          nameKey="week"
                          dataKey="enrollments"
                          seriesName="Enrollments"
                          height={280}
                        />
                      </Box>
                      <Flex gap={4} marginBottom={6} wrap="wrap">
                        <Box style={{ flex: '1 1 340px', minWidth: 280 }}>
                          <FunnelChart
                            data={data.completionFunnel || []}
                            title="Completion Funnel"
                            nameKey="stage"
                            dataKey="value"
                            height={280}
                          />
                        </Box>
                        <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
                          <DonutChart
                            data={data.statusDistribution || []}
                            title="Course Status Distribution"
                            height={280}
                          />
                        </Box>
                      </Flex>
                    </>
                  )}
                  {courseContentViewType === 'table' && (
                    <>
                      <Box marginBottom={6}>
                        <DataTable
                          data={data.learningActivityByWeek || []}
                          title="Learning Activity by Week"
                          fontSize="16px"
                          columns={[
                            { key: 'week', label: 'Week' },
                            { key: 'enrollments', label: 'Enrollments' },
                          ]}
                        />
                      </Box>
                      <Flex gap={4} marginBottom={6} wrap="wrap">
                        <Box style={{ flex: '1 1 340px', minWidth: 280 }}>
                          <DataTable
                            data={data.completionFunnel || []}
                            title="Completion Funnel"
                            fontSize="16px"
                            columns={[
                              { key: 'stage', label: 'Stage' },
                              { key: 'value', label: 'Count' },
                            ]}
                          />
                        </Box>
                        <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
                          <DataTable
                            data={data.statusDistribution || []}
                            title="Course Status Distribution"
                            fontSize="16px"
                            columns={[
                              { key: 'name', label: 'Status' },
                              { key: 'value', label: 'Count' },
                            ]}
                          />
                        </Box>
                      </Flex>
                      {(data.departmentDistribution?.length > 0 || data.monthlyCompletions?.length > 0) && (
                        <Flex gap={4} marginBottom={6} wrap="wrap">
                          {data.departmentDistribution?.length > 0 && (
                            <Box style={{ flex: '1 1 340px', minWidth: 280 }}>
                              <DataTable
                                data={data.departmentDistribution}
                                title="Department Distribution"
                                fontSize="16px"
                                columns={[
                                  { key: 'name', label: 'Department' },
                                  { key: 'value', label: 'Count' },
                                ]}
                              />
                            </Box>
                          )}
                          {Array.isArray(data.monthlyCompletions) && data.monthlyCompletions.length > 0 && (
                            <Box style={{ flex: '1 1 340px', minWidth: 280 }}>
                              <DataTable
                                data={data.monthlyCompletions}
                                title="Monthly Completions"
                                fontSize="16px"
                                columns={[
                                  { key: 'month', label: 'Month' },
                                  { key: 'value', label: 'Count' },
                                ]}
                              />
                            </Box>
                          )}
                        </Flex>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Personal view: when module selected only tables; otherwise KPIs/charts + tables */}
              {isPersonal && (
                <>
                  {filterModule ? (
                    <>
                      {/* Module selected: only My course progress + Module detail table */}
                      <Box marginBottom={6}>
                        {data?.courseProgress && data.courseProgress.length > 0 ? (
                          <DataTable
                            data={data.courseProgress}
                            title="My Course Progress"
                            fontSize="16px"
                            columns={[
                              { key: 'courseTitle', label: 'Course' },
                              { key: 'courseCategory', label: 'Category' },
                              { key: 'status', label: 'Status' },
                              { key: 'percentage', label: 'Progress %', render: (v) => `${v}%` },
                              { key: 'timeSpentMinutes', label: 'Time (min)' },
                              { key: 'certificateIssued', label: 'Certificate', render: (v) => (v ? 'Yes' : 'No') },
                            ]}
                          />
                        ) : (
                          <Box padding={6} background="neutral100" hasRadius>
                            <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 8 }}>My Course Progress</Typography>
                            <Typography textColor="neutral600">No course progress data for this employee yet.</Typography>
                          </Box>
                        )}
                      </Box>
                      <Box marginBottom={6}>
                        {(() => {
                          const moduleRows = (data?.moduleVideoProgress || []).filter((m) => m.moduleTitle === filterModule);
                          const formatCompletionType = (v) => {
                            if (!v) return '—';
                            const labels = { full_watch: 'Watched fully', skipped_to_end: 'Skipped to end', in_progress: 'In progress', not_started: 'Not started' };
                            return labels[v] || v;
                          };
                          return moduleRows.length > 0 ? (
                            <DataTable
                              data={moduleRows}
                              title="Module detail"
                              fontSize="16px"
                              columns={[
                                { key: 'courseTitle', label: 'Course' },
                                { key: 'moduleTitle', label: 'Module' },
                                { key: 'videoCompletionType', label: 'Completion', render: formatCompletionType },
                                { key: 'timeWatchedMinutes', label: 'Time watched (min)' },
                                { key: 'videoDurationMinutes', label: 'Duration (min)' },
                              ]}
                            />
                          ) : (
                            <Box padding={6} background="neutral100" hasRadius>
                              <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 8 }}>Module detail</Typography>
                              <Typography textColor="neutral600">No module video data for the selected module.</Typography>
                            </Box>
                          );
                        })()}
                      </Box>
                    </>
                  ) : (
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
                      <Box marginBottom={6}>
                        <BarChart
                          data={Array.isArray(data?.courseProgress) ? data.courseProgress.map(c => ({ name: c.courseTitle, value: c.timeSpentMinutes ?? 0, category: c.courseCategory || '' })) : []}
                          title="Time Spent per Course"
                          nameKey="name"
                          dataKey="value"
                          height={260}
                          valueLabel="Total Time Spent"
                          valueUnit="min"
                          layout="horizontal"
                          tooltipFormatter={(value, name, props) => {
                            const category = props?.payload?.category ?? '';
                            return [value + ' min', category ? `Category: ${category}` : undefined];
                          }}
                        />
                      </Box>
                      <Box marginBottom={6}>
                        <DonutChart
                          data={(() => {
                            if (!Array.isArray(data?.courseProgress)) return [];
                            const completed = data.courseProgress.filter(c => c.status === 'Completed').length;
                            const inProgress = data.courseProgress.filter(c => c.status === 'In_progress').length;
                            const certificate = data.courseProgress.filter(c => c.certificateIssued).length;
                            const quizPass = data.courseProgress.filter(c => c.quizPassed).length;
                            const feedbackPending = data.courseProgress.filter(c => c.feedbackGiven === false || c.feedbackPending).length;
                            const segments = [
                              { name: 'Completed', value: completed },
                              { name: 'In Progress', value: inProgress },
                              { name: 'Certificate Earned', value: certificate },
                            ];
                            if (quizPass > 0) segments.push({ name: 'Quiz Pass', value: quizPass });
                            if (data.courseProgress.some(c => c.feedbackGiven !== undefined || c.feedbackPending !== undefined)) {
                              segments.push({ name: 'Feedback Pending', value: feedbackPending });
                            }
                            return segments;
                          })()}
                          title="Course Distribution"
                          height={260}
                        />
                      </Box>
                      {data?.courseProgress && data.courseProgress.length > 0 ? (
                        <Box marginBottom={6}>
                          <DataTable
                            data={data.courseProgress.slice((courseProgressPage - 1) * courseProgressPageSize, courseProgressPage * courseProgressPageSize)}
                            title="My Course Progress"
                            fontSize="16px"
                            pagination={{
                              page: courseProgressPage,
                              pageSize: courseProgressPageSize,
                              total: data.courseProgress.length,
                              onPageChange: setCourseProgressPage,
                              onPageSizeChange: (v) => { setCourseProgressPageSize(Number(v)); setCourseProgressPage(1); },
                            }}
                            columns={[
                              { key: 'courseTitle', label: 'Course' },
                              { key: 'courseCategory', label: 'Category' },
                              { key: 'status', label: 'Status' },
                              { key: 'percentage', label: 'Progress %', render: (v) => `${v}%` },
                              { key: 'timeSpentMinutes', label: 'Time (min)' },
                              { key: 'certificateIssued', label: 'Certificate', render: (v) => (v ? 'Yes' : 'No') },
                            ]}
                          />
                        </Box>
                      ) : (
                        <Box marginBottom={6} padding={6} background="neutral100" hasRadius>
                          <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold" style={{ marginBottom: 8 }}>My Course Progress</Typography>
                          <Typography textColor="neutral600">No course progress data for this employee yet.</Typography>
                        </Box>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Course view: when module selected, show module detail table (all users) */}
              {!isPersonal && filterModule && Array.isArray(data?.moduleDetailTable) && data.moduleDetailTable.length > 0 && (
                <Box marginBottom={6}>
                  <DataTable
                    data={data.moduleDetailTable}
                    title="Module detail (all users)"
                    fontSize="16px"
                    columns={[
                      { key: 'userName', label: 'User' },
                      { key: 'courseTitle', label: 'Course' },
                      { key: 'moduleTitle', label: 'Module' },
                      { key: 'videoCompletionType', label: 'Completion', render: (v) => {
                        const labels = { full_watch: 'Watched fully', skipped_to_end: 'Skipped to end', in_progress: 'In progress', not_started: 'Not started' };
                        return labels[v] || v || '—';
                      }},
                      { key: 'timeWatchedMinutes', label: 'Time watched (min)' },
                      { key: 'videoDurationMinutes', label: 'Duration (min)' },
                    ]}
                  />
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