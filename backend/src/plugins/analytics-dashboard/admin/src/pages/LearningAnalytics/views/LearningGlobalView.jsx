import React from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { DonutChart } from '../../../components/DonutChart';
import { LineChart } from '../../../components/LineChart';
import { FunnelChart } from '../../../components/FunnelChart';
import { DataTable } from '../../../components/DataTable';

/**
 * Learning Analytics – Course (global) view.
 * Renders KPIs, statistics/table toggle, charts or tables, and module detail table when course+module selected.
 */
export function LearningGlobalView({
  data,
  courseContentViewType,
  setCourseContentViewType,
  kpis,
  quiz,
  filterCourse,
  filterModule,
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

      {courseContentViewType === 'table' && (
        <>
          <Box marginBottom={6}>
            <DataTable
              data={data?.learningActivityByWeek || []}
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
                data={data?.completionFunnel || []}
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
                data={data?.statusDistribution || []}
                title="Course Status Distribution"
                fontSize="16px"
                columns={[
                  { key: 'name', label: 'Status' },
                  { key: 'value', label: 'Count' },
                ]}
              />
            </Box>
          </Flex>
          {(data?.departmentDistribution?.length > 0 || data?.monthlyCompletions?.length > 0) && (
            <Flex gap={4} marginBottom={6} wrap="wrap">
              {data?.departmentDistribution?.length > 0 && (
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
              {Array.isArray(data?.monthlyCompletions) && data.monthlyCompletions.length > 0 && (
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

      {filterCourse && filterModule && (
        <Box marginBottom={6}>
          <DataTable
            data={Array.isArray(data?.moduleDetailTable) ? data.moduleDetailTable : []}
            title="Module detail (all users)"
            fontSize="16px"
            columns={[
              { key: 'userName', label: 'User' },
              { key: 'courseTitle', label: 'Course' },
              { key: 'moduleTitle', label: 'Module' },
              {
                key: 'videoCompletionType',
                label: 'Completion',
                render: (v) => {
                  const labels = { full_watch: 'Watched fully', skipped_to_end: 'Skipped to end', in_progress: 'In progress', not_started: 'Not started' };
                  return labels[v] || v || '—';
                },
              },
              { key: 'timeWatchedMinutes', label: 'Time watched (min)' },
              { key: 'videoDurationMinutes', label: 'Duration (min)' },
            ]}
          />
        </Box>
      )}
    </>
  );
}
