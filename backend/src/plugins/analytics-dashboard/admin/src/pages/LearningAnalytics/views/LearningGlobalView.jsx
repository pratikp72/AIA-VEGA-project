import React from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { DonutChart } from '../../../components/DonutChart';
import { LineChart } from '../../../components/LineChart';
import { FunnelChart } from '../../../components/FunnelChart';
import { DataTable } from '../../../components/DataTable';

/**
 * Learning Analytics – Course (global) view.
 * Statistics view: charts (Learning Activity, Completion Funnel, Status Distribution).
 * Table view: Module detail table only (all modules of all courses, or all modules of selected course).
 */
export function LearningGlobalView({
  data,
  courseContentViewType,
  setCourseContentViewType,
  kpis,
  quiz,
  filterCourse,
  filterModule,
  moduleDetailPage,
  moduleDetailPageSize,
  setModuleDetailPage,
  setModuleDetailPageSize,
}) {
  return (
    <>
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

      {courseContentViewType === 'statistics' && (
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

      {courseContentViewType === 'table' && (() => {
        const hasCourse = Boolean(filterCourse);
        if (hasCourse) {
          const pivot = data?.moduleDetailPivot ?? { moduleColumns: [], rows: [] };
          const rows = Array.isArray(pivot.rows) ? pivot.rows : [];
          const moduleCols = Array.isArray(pivot.moduleColumns) ? pivot.moduleColumns : [];
          const columns = [
            { key: 'userName', label: 'User' },
            ...moduleCols.map((c) => ({
              key: c.key,
              label: c.label,
              exportLabel: `${c.label} (watched/duration min)`,
              header: (
                <Flex direction="column" gap={0} alignItems="flex-start">
                  <Typography variant="sigma" textColor="neutral600">{c.label}</Typography>
                  <Typography variant="pi" textColor="neutral500" style={{ fontSize: '11px', fontWeight: 'normal' }}>
                    watched/duration min
                  </Typography>
                </Flex>
              ),
            })),
          ];
          const paginatedData = rows.length ? rows.slice((moduleDetailPage - 1) * moduleDetailPageSize, moduleDetailPage * moduleDetailPageSize) : [];
          return (
            <Box marginBottom={6}>
              <DataTable
                data={paginatedData}
                title="Module detail by user"
                exportFileName="module-detail-by-user.xlsx"
                emptyMessage="No module video data for this course."
                pagination={rows.length ? {
                  page: moduleDetailPage,
                  pageSize: moduleDetailPageSize,
                  total: rows.length,
                  onPageChange: setModuleDetailPage,
                  onPageSizeChange: (v) => {
                    setModuleDetailPageSize(Number(v));
                    setModuleDetailPage(1);
                  },
                } : null}
                columns={columns}
              />
            </Box>
          );
        }
        const rows = Array.isArray(data?.moduleDetailTable) ? data.moduleDetailTable : [];
        const paginatedData = rows.length ? rows.slice((moduleDetailPage - 1) * moduleDetailPageSize, moduleDetailPage * moduleDetailPageSize) : [];
        return (
          <Box marginBottom={6}>
            <DataTable
              data={paginatedData}
              title="Module detail (all users)"
              exportFileName="module-detail.xlsx"
              pagination={rows.length ? {
                page: moduleDetailPage,
                pageSize: moduleDetailPageSize,
                total: rows.length,
                onPageChange: setModuleDetailPage,
                onPageSizeChange: (v) => {
                  setModuleDetailPageSize(Number(v));
                  setModuleDetailPage(1);
                },
              } : null}
              columns={[
                { key: 'userName', label: 'User' },
                { key: 'courseTitle', label: 'Course' },
                { key: 'moduleTitle', label: 'Module' },
                { key: 'timeWatchedMinutes', label: 'Time watched (min)' },
                { key: 'videoDurationMinutes', label: 'Duration (min)' },
              ]}
            />
          </Box>
        );
      })()}
    </>
  );
}
