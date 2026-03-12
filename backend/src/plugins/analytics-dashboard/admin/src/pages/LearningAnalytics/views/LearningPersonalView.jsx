import React, { useState, useMemo } from 'react';
import { Box, Flex, Typography, Button } from '@strapi/design-system';
import { StatCard } from '../../../components/StatCard';
import { DonutChart } from '../../../components/DonutChart';
import { BarChart } from '../../../components/BarChart';
import { DataTable } from '../../../components/DataTable';

/**
 * Learning Analytics – Personal view.
 * One "My Course" table: no course = standard table; course selected = base columns + module columns (watched/duration);
 * course + module selected = base + one module column. Module detail table removed when module selected.
 * Table/Chart toggle (right-aligned) for both no-course and course-selected states.
 */
export function LearningPersonalView({
  data,
  employeeDetail,
  filterCourse,
  filterModule,
  courseModules = [],
  kpis,
  live,
  quiz,
  courseProgressPage,
  courseProgressPageSize,
  setCourseProgressPage,
  setCourseProgressPageSize,
  onExport,
}) {
  const [dataView, setDataView] = useState('table'); // 'table' | 'chart'
  const [downloadStyle, setDownloadStyle] = React.useState('shown');
  const hasCourse = Boolean(filterCourse);
  const hasModule = Boolean(filterModule !== '' && filterModule != null);
  const moduleIndexSelected = hasModule ? (Number(filterModule)) : null;
  const liveTotals = live?.totals || {};

  const courseProgress = Array.isArray(data?.courseProgress) ? data.courseProgress : [];
  const moduleVideoProgress = Array.isArray(data?.moduleVideoProgress) ? data.moduleVideoProgress : [];

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

  const tableDataWithModuleCells = useMemo(() => {
    const modCols = moduleColumnsForCourse;
    if (modCols.length === 0) return tableRows;

    const matchCourseId = (rowCid, mvCid) => {
      if (rowCid == null || mvCid == null) return false;
      if (String(rowCid) === String(mvCid)) return true;
      const rn = Number(rowCid);
      const mn = Number(mvCid);
      return !Number.isNaN(rn) && !Number.isNaN(mn) && rn === mn;
    };

    return tableRows.map((row) => {
      const rowCourseId = row.courseId ?? row.course?.id ?? row.course?.documentId ?? '';
      const modMap = {};
      moduleVideoProgress.forEach((mv) => {
        const mvCourseId = mv.courseId ?? mv.course?.id ?? '';
        if (!matchCourseId(rowCourseId, mvCourseId)) return;
        const idx = mv.moduleIndex ?? mv.module_index;
        if (idx === undefined || idx === null) return;
        const watched = mv.timeWatchedMinutes ?? 0;
        const dur = mv.videoDurationMinutes ?? null;
        const val = dur != null && Number(dur) > 0 ? `${watched}/${dur}` : (watched ? String(watched) : '—');
        modMap[`mod_${idx}`] = val;
      });
      const base = { ...row };
      modCols.forEach((c) => {
        if (base[c.key] === undefined) base[c.key] = modMap[c.key] ?? '—';
      });
      return base;
    });
  }, [tableRows, moduleVideoProgress, moduleColumnsForCourse]);

  const tableColumns = useMemo(() => {
    const base = [
      { key: 'courseTitle', label: 'Course' },
      { key: 'courseCategory', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'percentage', label: 'Progress %', render: (v) => (v != null ? `${v}%` : '—') },
      { key: 'timeSpentMinutes', label: 'Time (min)' },
      { key: 'certificateIssued', label: 'Certificate', render: (v) => (v ? 'Yes' : 'No') },
      { key: 'inactiveDays', label: 'Inactive Days', render: (v) => v != null ? `${v} days` : '—' },
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
    if (!tableDataWithModuleCells.length) return [];
    const start = (courseProgressPage - 1) * courseProgressPageSize;
    return tableDataWithModuleCells.slice(start, start + courseProgressPageSize);
  }, [tableDataWithModuleCells, courseProgressPage, courseProgressPageSize]);

  const showKpis = true;

  return (
    <>
      {showKpis && (
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
            <StatCard label="Last Course Viewed" value={kpis.lastCourseViewed?.courseTitle ?? '—'} />
          </Box>
          <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
            <StatCard label="Last Course Completed" value={kpis.lastCourseCompleted?.courseTitle ?? '—'} />
          </Box>
        </Flex>
      )}

      <Flex gap={4} marginBottom={6} wrap="wrap">
        <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
          <StatCard label="Live Learning Time" value={`${Math.round((((liveTotals.module_time_seconds ?? 0) + (liveTotals.video_time_seconds ?? 0)) / 60) * 10) / 10} min`} colorIndex={2} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
          <StatCard label="Live Quiz Time" value={`${Math.round(((liveTotals.quiz_time_seconds ?? 0) / 60) * 10) / 10} min`} colorIndex={4} />
        </Box>
        <Box style={{ flex: '1 1 200px', minWidth: 160 }}>
          <StatCard label="Live Feedback Time" value={`${Math.round(((liveTotals.feedback_time_seconds ?? 0) / 60) * 10) / 10} min`} colorIndex={5} />
        </Box>
      </Flex>

      <Flex marginBottom={4} gap={2} alignItems="center" justifyContent="flex-end">
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

      {dataView === 'chart' && (
        <>
          {/* {!hasModule && (
            <Flex justifyContent="flex-end" marginBottom={2}>
              <Button
                variant="secondary"
                size="M"
                onClick={onExport}
                disabled={!courseProgress?.length || !employeeDetail}
              >
                Download
              </Button>
            </Flex>
          )} */}
          <Box marginBottom={6}>
            <BarChart
              data={(() => {
                // If no course selected, show time spent per course
                if (!hasCourse) {
                  return Array.isArray(courseProgress)
                    ? courseProgress.map((c) => ({
                        name: c.courseTitle,
                        value: c.timeSpentMinutes ?? 0,
                        category: c.courseCategory || '',
                      }))
                    : [];
                }
                // If course selected, show time spent per module for that user
                if (hasCourse && courseModules.length > 0) {
                  const cp = tableRows[0];
                  if (!cp) return [];
                  return courseModules.map((mod) => {
                    // Try to extract watched and duration from cp[`mod_${mod.index}`]
                    const modVal = cp[`mod_${mod.index}`];
                    let watched = 0, duration = null;
                    if (typeof modVal === 'string' && modVal.includes('/')) {
                      const [w, d] = modVal.split('/').map(s => s.trim());
                      watched = Number(w) || 0;
                      duration = d ? Number(d) : null;
                    } else if (!isNaN(Number(modVal))) {
                      watched = Number(modVal);
                    }
                    return {
                      name: mod.title ?? `Module ${mod.index + 1}`,
                      value: watched,
                      watched,
                      duration,
                    };
                  });
                }
                return [];
              })()}
              title={hasCourse ? 'Time Spent per Module' : 'Time Spent per Course'}
              nameKey="name"
              dataKey="value"
              height={hasCourse ? 320 : 260}
              valueLabel={hasCourse ? 'Time Spent' : 'Total Time Spent'}
              valueUnit="min"
              layout="horizontal"
              tooltipFormatter={(value, name, props) => {
                // For module view, show watched/duration if available
                if (hasCourse && props?.payload) {
                  const { watched, duration } = props.payload;
                  if (watched != null && duration != null) return [`${watched}/${duration} min`];
                  if (watched != null) return [`${watched} min`];
                }
                // For course view, show value as min
                return [`${value} min`];
              }}
            />
          </Box>
          <Box marginBottom={6}>
            <DonutChart
              data={(() => {
                if (!Array.isArray(courseProgress)) return [];
                const completed = courseProgress.filter((c) => c.status === 'Completed').length;
                const inProgress = courseProgress.filter((c) => c.status === 'In_progress').length;
                const certificate = courseProgress.filter((c) => c.certificateIssued).length;
                const quizPass = courseProgress.filter((c) => c.quizPassed).length;
                const feedbackPending = courseProgress.filter((c) => c.feedbackGiven === false || c.feedbackPending).length;
                const segments = [
                  { name: 'Completed', value: completed },
                  { name: 'In Progress', value: inProgress },
                  { name: 'Certificate Earned', value: certificate },
                ];
                if (quizPass > 0) segments.push({ name: 'Quiz Pass', value: quizPass });
                if (courseProgress.some((c) => c.feedbackGiven !== undefined || c.feedbackPending !== undefined)) {
                  segments.push({ name: 'Feedback Pending', value: feedbackPending });
                }
                return segments;
              })()}
              title="Course Distribution"
              height={260}
            />
          </Box>
        </>
      )}

      {dataView === 'table' && (
        <Box marginBottom={6}>
          <DataTable
            data={downloadStyle === 'all' ? tableRows : paginatedTableData}
            fullData={tableRows}
            paginatedData={paginatedTableData}
            downloadStyle={downloadStyle}
            title="My Course Progress"
            exportFileName="my-course-progress.xlsx"
            emptyMessage={hasCourse ? (hasModule ? 'No data for the selected course and module.' : 'No data for the selected course.') : 'No course progress data for this employee yet.'}
            pagination={tableDataWithModuleCells.length > 0 ? {
              page: courseProgressPage,
              pageSize: courseProgressPageSize,
              total: tableDataWithModuleCells.length,
              onPageChange: setCourseProgressPage,
              onPageSizeChange: (v) => {
                setCourseProgressPageSize(Number(v));
                setCourseProgressPage(1);
              },
            } : null}
            columns={tableColumns}
          />
        </Box>
      )}
    </>
  );
}
