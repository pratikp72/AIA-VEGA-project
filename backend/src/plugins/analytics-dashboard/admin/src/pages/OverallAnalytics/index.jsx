import React, { useState, useEffect, useCallback } from 'react';
import { Page, Layouts } from '@strapi/admin/strapi-admin';
import { Box, Flex, Typography, Loader } from '@strapi/design-system';
import { useAnalytics } from '../../hooks/useAnalytics';
import { StatCard } from '../../components/StatCard';
import { DonutChart } from '../../components/DonutChart';
import { BarChart } from '../../components/BarChart';
import { MultiLineChart } from '../../components/MultiLineChart';
import { DataTable } from '../../components/DataTable';
import { Filters } from '../../components/Filters';
import { EmployeeSearch } from '../../components/EmployeeSearch';
import { EmployeeDetailCard } from '../../components/EmployeeDetailCard';

export default function OverallAnalyticsPage() {
  const {
    fetchOverallGlobal,
    fetchOverallPersonal,
    fetchDepartments,
    fetchUnitLocations,
    fetchActivityTimeByTypeAndDay,
    fetchActivityLog,
  } = useAnalytics();
  const [viewMode, setViewMode] = useState('activityTracking');
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [department, setDepartment] = useState('');
  const [company, setCompany] = useState('');
  const [unitLocation, setUnitLocation] = useState('');
  const [activityType, setActivityType] = useState('');
  const [employeeId, setEmployeeId] = useState(null);
  const [employeeDetail, setEmployeeDetail] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [unitLocations, setUnitLocations] = useState([]);
  const [data, setData] = useState(null);
  const [activityChartData, setActivityChartData] = useState([]);
  const [activityLogData, setActivityLogData] = useState({ rows: [], total: 0, page: 1, pageSize: 10 });
  const [activityLogPage, setActivityLogPage] = useState(1);
  const [activityLogPageSize, setActivityLogPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
    fetchUnitLocations().then(setUnitLocations).catch(() => setUnitLocations([]));
  }, []);

  useEffect(() => {
    if (viewMode === 'activityTracking') setActivityLogPage(1);
  }, [viewMode, activityType, dateFrom, dateTo, company, department, unitLocation]);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = {};
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (company) params.company = company;
    if (department) params.department = department;
    if (unitLocation) params.unitLocation = unitLocation;
    if (activityType) params.activityType = activityType;

    if (viewMode === 'activityTracking') {
      Promise.all([
        fetchActivityTimeByTypeAndDay(params),
        fetchActivityLog({ ...params, page: activityLogPage, pageSize: activityLogPageSize }),
      ])
        .then(([chartData, logData]) => {
          setActivityChartData(Array.isArray(chartData) ? chartData : []);
          setActivityLogData(logData || { rows: [], total: 0, page: 1, pageSize: 10 });
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
      return;
    }

    const fetcher =
      viewMode === 'personal' && employeeId
        ? () => fetchOverallPersonal({ ...params, userId: employeeId })
        : () => fetchOverallGlobal(params);

    fetcher()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [viewMode, employeeId, dateFrom, dateTo, company, department, unitLocation, activityType, activityLogPage, activityLogPageSize]);

  useEffect(() => {
    if (viewMode === 'global' || viewMode === 'activityTracking' || (viewMode === 'personal' && employeeId)) {
      loadData();
    } else {
      setData(null);
      setLoading(false);
    }
  }, [viewMode, employeeId, dateFrom, dateTo, company, unitLocation, activityType, loadData]);

  const kpis = data?.kpis || {};
  const isPersonal = viewMode === 'personal';
  const isActivityTracking = viewMode === 'activityTracking';

  return (
    <>
      <Page.Title>Overall Analytics</Page.Title>
      <Page.Main>
        <Layouts.Header
          title="Overall Analytics"
          subtitle={
            isPersonal
              ? 'Personal portal engagement'
              : isActivityTracking
                ? 'Activity tracking across the portal'
                : 'Content portal engagement'
          }
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
              showUnitLocation
              showActivityTracking
              unitLocation={unitLocation}
              onUnitLocationChange={setUnitLocation}
              unitLocations={unitLocations}
              activityType={activityType}
              onActivityTypeChange={setActivityType}
              search=""
              onSearchChange={() => {}}
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

            {!loading && isActivityTracking && (
              <>
                <Box marginBottom={6}>
                  <MultiLineChart
                    data={activityChartData}
                    title="USER ACTIVITY TRACKING - TIME SPENT"
                    nameKey="date"
                    lines={
                      activityType
                        ? [activityType]
                        : ['News_Reading', 'Event_Info', 'Townhall_PDF', 'Townhall_Video', 'Holiday_View']
                    }
                    height={300}
                  />
                </Box>
                <Box>
                  <DataTable
                    data={activityLogData.rows}
                    fontSize={16}
                    columns={[
                      { key: 'userName', label: 'USER' },
                      { key: 'company', label: 'COMPANY' },
                      { key: 'activity', label: 'ACTIVITY' },
                      { key: 'duration', label: 'DURATION' },
                      {
                        key: 'timestamp',
                        label: 'DATE',
                        render: (val) => (val ? new Date(val).toLocaleString() : '—'),
                      },
                    ]}
                    title="Recent Activity Log"
                    exportFileName="activity-log.xlsx"
                    pagination={{
                      page: activityLogData.page,
                      pageSize: activityLogData.pageSize,
                      total: activityLogData.total,
                      onPageChange: setActivityLogPage,
                      onPageSizeChange: (v) => setActivityLogPageSize(Number(v)),
                    }}
                  />
                </Box>
              </>
            )}

            {!loading && data && !isActivityTracking && (
              <>
                {isPersonal && employeeDetail && (
                  <EmployeeDetailCard employee={employeeDetail} />
                )}
                {/* KPIs */}
                <Flex gap={4} marginBottom={6} wrap="wrap">
                  <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                    <StatCard label="Total Users" value={kpis.totalUsers} subtext="" colorIndex={0} />
                  </Box>
                  <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                    <StatCard label="Holidays" value={kpis.totalHolidays} subtext="" colorIndex={1} />
                  </Box>
                  <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                    <StatCard label="News Items" value={kpis.totalNews} subtext="" colorIndex={2} />
                  </Box>
                  <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                    <StatCard label="Events" value={kpis.totalEvents} subtext="" colorIndex={3} />
                  </Box>
                  <Box style={{ flex: '1 1 200px', minWidth: 180 }}>
                    <StatCard label="Townhalls" value={kpis.totalTownhalls} subtext="" colorIndex={4} />
                  </Box>
                </Flex>

                {/* Holidays by Month + Employees by Company */}
                <Flex gap={4} marginBottom={6} wrap="wrap">
                  {data.holidayByMonth?.length > 0 && (
                    <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
                      <DonutChart
                        data={data.holidayByMonth}
                        title="Holidays by Month"
                        height={260}
                      />
                    </Box>
                  )}
                  {data.employeesByCompany?.length > 0 && (
                    <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
                      <DonutChart
                        data={data.employeesByCompany}
                        title="Employees by Company"
                        height={260}
                        showActiveInTooltip
                      />
                    </Box>
                  )}
                </Flex>

                {/* Bar Charts */}
                <Flex gap={4} marginBottom={6} wrap="wrap">
                  {data.newsByCategory?.length > 0 && (
                    <Box style={{ flex: '1 1 350px', minWidth: 280 }}>
                      <BarChart
                        data={data.newsByCategory}
                        title="News by Category"
                        nameKey="name"
                        dataKey="value"
                        height={260}
                      />
                    </Box>
                  )}
                  {data.eventsByType?.length > 0 && (
                    <Box style={{ flex: '1 1 350px', minWidth: 280 }}>
                      <BarChart
                        data={data.eventsByType}
                        title="Events by Type"
                        nameKey="name"
                        dataKey="value"
                        height={260}
                      />
                    </Box>
                  )}
                  {data.townhallByContentType?.length > 0 && (
                    <Box style={{ flex: '1 1 350px', minWidth: 280 }}>
                      <BarChart
                        data={data.townhallByContentType}
                        title="Townhall Matrix (by Content Type)"
                        nameKey="name"
                        dataKey="value"
                        height={260}
                      />
                    </Box>
                  )}
                </Flex>
              </>
            )}

            {!loading && !data && viewMode === 'personal' && !employeeId && (
              <Box padding={6} background="neutral100" hasRadius>
                <Typography textColor="neutral600">
                  Search for an employee by ID or email to view personal overall analytics.
                </Typography>
              </Box>
            )}
          </Box>
        </Layouts.Content>
      </Page.Main>
    </>
  );
}
