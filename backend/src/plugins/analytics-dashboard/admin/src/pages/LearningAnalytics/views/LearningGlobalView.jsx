import React, { useMemo } from 'react';
import { Box, Flex, Typography, Button } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { DonutChart } from '../../../components/DonutChart';
import { LineChart } from '../../../components/LineChart';
import { FunnelChart } from '../../../components/FunnelChart';
import { DataTable } from '../../../components/DataTable';

/**
 * Learning Analytics – Course (global) view.
 * Same table as Personal view but data across all users. One table only; Table/Chart toggle (right-aligned).
 */
export function LearningGlobalView({
  data,
  courseContentViewType,
  setCourseContentViewType,
  kpis,
  quiz,
  filterCourse,
  filterModule,
  courseModules = [],
  moduleDetailPage,
  moduleDetailPageSize,
  setModuleDetailPage,
  setModuleDetailPageSize,
}) {
  const dataView = courseContentViewType === 'table' ? 'table' : 'chart';
  const setDataView = (v) => setCourseContentViewType(v === 'table' ? 'table' : 'statistics');

  const hasCourse = Boolean(filterCourse);
  const hasModule = Boolean(filterModule !== '' && filterModule != null);
  const moduleIndexSelected = hasModule ? Number(filterModule) : null;

  const courseProgress = Array.isArray(data?.courseProgress) ? data.courseProgress : [];

  const tableRows = useMemo(() => {
    if (!hasCourse) return courseProgress;
    const courseIdStr = String(filterCourse).trim();
    return courseProgress.filter((p) => {
      const id = p.courseId ?? p.course?.id ?? p.course?.documentId ?? '';
      const title = (p.courseTitle ?? p.course?.title ?? '').trim().toLowerCase();
      const matchId = String(id) === courseIdStr || (courseIdStr.length <= 10 && Number(id) === Number(courseIdStr));
      const matchTitle = courseIdStr.length > 10 && title && (title === courseIdStr.toLowerCase() || title.includes(courseIdStr.toLowerCase()));
      return matchId || matchTitle;
    });
  }, [hasCourse, filterCourse, courseProgress]);

  const moduleColumnsForCourse = useMemo(() => {
    if (!hasCourse || !courseModules.length) return [];
    if (hasModule && moduleIndexSelected !== null && !Number.isNaN(moduleIndexSelected)) {
      const m = courseModules.find((mod) => (mod.index ?? mod.moduleIndex) === moduleIndexSelected);
      if (!m) return [];
      const label = m.title ?? `Module ${(moduleIndexSelected ?? 0) + 1}`;
      const key = `mod_${moduleIndexSelected}`;
      return [{ key, label, moduleIndex: moduleIndexSelected }];
    }
    return courseModules.map((m) => {
      const idx = m.index ?? m.moduleIndex ?? 0;
      return { key: `mod_${idx}`, label: m.title ?? `Module ${idx + 1}`, moduleIndex: idx };
    });
  }, [hasCourse, hasModule, moduleIndexSelected, courseModules]);

  const tableColumns = useMemo(() => {
    const base = [
      { key: 'courseTitle', label: 'Course' },
      { key: 'courseCategory', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'percentage', label: 'Progress %', render: (v) => (v != null ? `${v}%` : '—') },
      { key: 'timeSpentMinutes', label: 'Time (min)' },
      { key: 'certificateIssued', label: 'Certificate' },
    ];
    const moduleColDefs = moduleColumnsForCourse.map((m) => ({
      key: m.key,
      label: m.label,
      exportLabel: `${m.label} (watched/duration min)`,
      header: (
        <Flex direction="column" gap={0} alignItems="flex-start">
          <Typography variant="sigma" textColor="neutral600">{m.label}</Typography>
          <Typography variant="pi" textColor="neutral500" style={{ fontSize: '11px', fontWeight: 'normal' }}>
            watched/duration min
          </Typography>
        </Flex>
      ),
    }));
    return [...base, ...moduleColDefs];
  }, [moduleColumnsForCourse]);

  const paginatedTableData = useMemo(() => {
    if (!tableRows.length) return [];
    const start = (moduleDetailPage - 1) * moduleDetailPageSize;
    return tableRows.slice(start, start + moduleDetailPageSize);
  }, [tableRows, moduleDetailPage, moduleDetailPageSize]);

  return (
    <>
      <Flex marginBottom={4} alignItems="center" justifyContent="flex-end" gap={2}>
        <Typography variant="sigma" textColor="neutral600" fontWeight="semiBold">
          View:
        </Typography>
        <Button variant={dataView === 'table' ? 'default' : 'tertiary'} size="S" onClick={() => setDataView('table')}>
          Table
        </Button>
        <Button variant={dataView === 'chart' ? 'default' : 'tertiary'} size="S" onClick={() => setDataView('chart')}>
          Chart
        </Button>
      </Flex>

      <Flex gap={4} marginBottom={6} wrap="wrap">
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
      </Flex>

      {dataView === 'chart' && (
        <>
          <Box style={{ width: '100%', marginBottom: 24 }}>
            <LineChart
              data={data?.learningActivityByWeek || []}
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
                data={data?.completionFunnel || []}
                title="Completion Funnel"
                nameKey="stage"
                dataKey="value"
                height={280}
              />
            </Box>
            <Box style={{ flex: '1 1 300px', minWidth: 280 }}>
              <DonutChart
                data={data?.statusDistribution || []}
                title="Course Status Distribution"
                height={280}
              />
            </Box>
          </Flex>
        </>
      )}

      {dataView === 'table' && (
        <Box marginBottom={6}>
          <DataTable
            data={paginatedTableData}
            title="Course Progress"
            exportFileName="course-progress.xlsx"
            emptyMessage={hasCourse ? (hasModule ? 'No data for the selected course and module.' : 'No data for the selected course.') : 'No course progress data.'}
            pagination={tableRows.length > 0 ? {
              page: moduleDetailPage,
              pageSize: moduleDetailPageSize,
              total: tableRows.length,
              onPageChange: setModuleDetailPage,
              onPageSizeChange: (v) => {
                setModuleDetailPageSize(Number(v));
                setModuleDetailPage(1);
              },
            } : null}
            columns={tableColumns}
          />
        </Box>
      )}
    </>
  );
}
