import React, { useState, useEffect, useCallback } from 'react';
import { Page, Layouts } from '@strapi/admin/strapi-admin';
import { Box, Flex, Typography, Loader } from '@strapi/design-system';
import { useAnalytics } from '../../hooks/useAnalytics';
import { Filters } from '../../components/Filters';
import { EmployeeSearch } from '../../components/EmployeeSearch';
import { EmployeeDetailCard } from '../../components/EmployeeDetailCard';
import { OverallActivityTrackingView } from './views/OverallActivityTrackingView';
import { OverallContentView } from './views/OverallContentView';

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
              <OverallActivityTrackingView
                activityChartData={activityChartData}
                activityType={activityType}
                activityLogData={activityLogData}
                setActivityLogPage={setActivityLogPage}
                setActivityLogPageSize={setActivityLogPageSize}
              />
            )}

            {!loading && data && !isActivityTracking && (
              <>
                {isPersonal && employeeDetail && (
                  <EmployeeDetailCard employee={employeeDetail} />
                )}
                <OverallContentView data={data} />
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
