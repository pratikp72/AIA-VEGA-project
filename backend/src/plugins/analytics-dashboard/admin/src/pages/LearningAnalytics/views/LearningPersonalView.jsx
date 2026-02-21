import React from 'react';
import { Box, Flex, Typography, Button } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { DonutChart } from '../../../components/DonutChart';
import { BarChart } from '../../../components/BarChart';
import { DataTable } from '../../../components/DataTable';

/**
 * Learning Analytics – Personal view.
 * Renders employee card, KPIs, and either module-focused tables or full personal content (charts + course progress).
 */
export function LearningPersonalView({
  data,
  employeeDetail,
  filterModule,
  kpis,
  quiz,
  courseProgressPage,
  courseProgressPageSize,
  setCourseProgressPage,
  setCourseProgressPageSize,
  onExport,
}) {
  const isModuleSelected = Boolean(filterModule);

  return (
    <>
      {/* KPI cards (hidden when module selected) */}
      {!isModuleSelected && (
        <Flex gap={4} marginBottom={6} wrap="wrap">
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
        </Flex>
      )}

      {isModuleSelected ? (
        <>
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
              const moduleRows = (data?.moduleVideoProgress || []).filter((m) =>
                (String(m.moduleTitle || '').trim().toLowerCase()) === (String(filterModule || '').trim().toLowerCase())
              );
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
              onClick={onExport}
              disabled={!data?.courseProgress?.length || !employeeDetail}
            >
              Download
            </Button>
          </Flex>
          <Box marginBottom={6}>
            <BarChart
              data={Array.isArray(data?.courseProgress) ? data.courseProgress.map((c) => ({ name: c.courseTitle, value: c.timeSpentMinutes ?? 0, category: c.courseCategory || '' })) : []}
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
                const completed = data.courseProgress.filter((c) => c.status === 'Completed').length;
                const inProgress = data.courseProgress.filter((c) => c.status === 'In_progress').length;
                const certificate = data.courseProgress.filter((c) => c.certificateIssued).length;
                const quizPass = data.courseProgress.filter((c) => c.quizPassed).length;
                const feedbackPending = data.courseProgress.filter((c) => c.feedbackGiven === false || c.feedbackPending).length;
                const segments = [
                  { name: 'Completed', value: completed },
                  { name: 'In Progress', value: inProgress },
                  { name: 'Certificate Earned', value: certificate },
                ];
                if (quizPass > 0) segments.push({ name: 'Quiz Pass', value: quizPass });
                if (data.courseProgress.some((c) => c.feedbackGiven !== undefined || c.feedbackPending !== undefined)) {
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
  );
}
