import React from 'react';
import { Box } from '@strapi/design-system';
import { MultiLineChart } from '../../../components/MultiLineChart';
import { DataTable } from '../../../components/DataTable';

/**
 * Overall Analytics – Activity Tracking view.
 * Renders time-by-type chart and activity log table.
 */
export function OverallActivityTrackingView({
  activityChartData,
  activityType,
  activityLogData,
  setActivityLogPage,
  setActivityLogPageSize,
}) {
  return (
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
  );
}
