# Analytics Dashboard – Complete Guide

This guide covers the custom analytics API, dashboards setup, and troubleshooting for the UI-LM Portal backend.

---

## 1. Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build Strapi:**
   ```bash
   npm run build
   ```

3. **Start Strapi:**
   ```bash
   npm run develop
   ```

4. **Grant permission:**
   - Strapi Admin → Settings → Administration Panel → Roles
   - Edit HR Admin, LM Admin, Super Admin (or roles that should see dashboards)
   - Plugins → Analytics Dashboard → **Access Analytics Dashboard**
   - Save

5. **Access dashboards:**
   - Sidebar → **Learning Analytics**
   - Sidebar → **Overall Analytics**

---

## 2. What You Get

- **Learning Analytics** – Global + Personal views (KPIs, status distribution, completion trend, by category/department, quiz stats)
- **Overall Analytics** – Global + Personal views (portal engagement, holidays, news, events, announcements)
- **Filters:** Date range, department, company, employee drill-down
- **Charts:** Stat cards, donuts, bar charts, line charts, tables
- **No extra services** – Node.js only (no Docker, MySQL, or Redis)

---

## 3. Analytics API Endpoints

Base URL: `http://localhost:1337`

### Learning Analytics

| Endpoint | Method | Description | Query Params |
|----------|--------|-------------|--------------|
| `/api/analytics/learning/global` | GET | Global learning metrics (all employees) | `dateFrom`, `dateTo`, `department`, `company`, `courseCategory` |
| `/api/analytics/learning/personal` | GET | Personal learning metrics (single employee) | **`userId`** (required), `dateFrom`, `dateTo`, `courseCategory` |

### Overall Analytics

| Endpoint | Method | Description | Query Params |
|----------|--------|-------------|--------------|
| `/api/analytics/overall/global` | GET | Global portal engagement | `dateFrom`, `dateTo`, `company` |
| `/api/analytics/overall/personal` | GET | Personal engagement | **`userId`** (required), `dateFrom`, `dateTo` |

### Utility Endpoints

| Endpoint | Method | Description | Query Params |
|----------|--------|-------------|--------------|
| `/api/analytics/employees` | GET | Employee list for drill-down dropdown | `company`, `department` |
| `/api/analytics/departments` | GET | Department list for filter dropdown | - |

### Example Requests

```bash
GET /api/analytics/learning/global?dateFrom=2024-01-01&dateTo=2024-12-31&department=1&company=AIA
GET /api/analytics/learning/personal?userId=5&dateFrom=2024-01-01
GET /api/analytics/employees?company=AIA
GET /api/analytics/overall/global?company=Vega
```

### Response Format (Learning Global)

```json
{
  "kpis": {
    "totalAssignments": 150,
    "completionRate": 72,
    "avgTimeSpentMinutes": 45,
    "certificatesIssued": 98
  },
  "statusDistribution": [
    { "name": "Not_started", "value": 12 },
    { "name": "In_progress", "value": 30 },
    { "name": "Completed", "value": 108 }
  ],
  "categoryDistribution": [...],
  "departmentDistribution": [...],
  "monthlyCompletions": [...],
  "quiz": { "passRate": 85, "avgScore": 78, "totalAttempts": 200 }
}
```

---

## 4. Dashboard Structure & Chart Types

### 4.1 Learning Analytics Dashboard

**Layout (top to bottom):**

| Row | Section | Chart Type | What It Shows | Data Source |
|-----|---------|------------|---------------|-------------|
| 1 | **KPIs** | **Stat Cards** (4 cards) | Total Assignments, Completion Rate %, Avg Time Spent, Certificates Issued | `kpis` |
| 2 | **Quiz Stats** | **Stat Cards** (2 cards) | Quiz Pass Rate %, Quiz Avg Score | `quiz` (when available) |
| 3 | **Course Status Distribution** | **Donut Chart** | Not Started / In Progress / Completed / Failed | `statusDistribution` |
| 3 | **Completion Trend Over Time** | **Line Chart** | Monthly completion count over time | `monthlyCompletions` |
| 4 | **Courses by Category** | **Bar Chart** (horizontal) | Count of courses per category (e.g. HR: 5, Tech: 3) | `categoryDistribution` |
| 4 | **By Department** | **Bar Chart** (horizontal) | Count of courses per department | `departmentDistribution` |
| 5 | **My Course Progress** | **Data Table** | Course name, status, progress %, time spent, certificate | `courseProgress` (Personal view only) |

**Note:** Charts show "No data available" when empty. The Course Progress table appears only in **Personal** view when an employee is selected.

---

### 4.2 Overall Analytics Dashboard

**Layout (top to bottom):**

| Row | Section | Chart Type | What It Shows | Data Source |
|-----|---------|------------|---------------|-------------|
| 1 | **KPIs** | **Stat Cards** (5 cards) | Total Users, Holidays, News Items, Events, Announcements | `kpis` |
| 2 | **Holidays by Month** | **Donut Chart** | Holiday count per month (Jan 2025, Feb 2025, etc.) | `holidayByMonth` |
| 2 | **Employees by Company** | **Donut Chart** | Employee count per company (AIA, Vega, etc.) | `employeesByCompany` |
| 3 | **News by Category** | **Bar Chart** (horizontal) | Count of news items per category | `newsByCategory` |
| 3 | **Events by Type** | **Bar Chart** (horizontal) | Count of events per type | `eventsByType` |
| 3 | **Announcements by Target** | **Bar Chart** (horizontal) | Count by target (All, Department, Role, etc.) | `announcementByTarget` |

**Note:** Charts are hidden when they have no data. Donut charts show "No data available" when all values are 0.

---

## 5. How Filtering Works

### 5.1 Filter Controls (Both Dashboards)

| Filter | Type | Options | What It Does |
|--------|------|---------|--------------|
| **View** | Dropdown | Global (All Employees) / Personal (Single Employee) | Switches between company-wide and single-employee view |
| **Employee** | Dropdown | List from `/api/analytics/employees` | Shown only when View = Personal. Select which employee to drill down into |
| **Date From** | Date picker | Any date | Start of date range (optional) |
| **Date To** | Date picker | Any date | End of date range (optional) |
| **Department** | Dropdown | All Departments + list from `/api/analytics/departments` | Filter data by department (Learning only; Overall shows it but does not use it in API) |
| **Company** | Dropdown | All Companies / AIA / Vega | Filter data by company |

---

### 5.2 Filter → API Flow

**Learning Analytics:**
- **Global:** `GET /api/analytics/learning/global?dateFrom=...&dateTo=...&department=...&company=...`
- **Personal:** `GET /api/analytics/learning/personal?userId=...&dateFrom=...&dateTo=...&department=...&company=...`

**Overall Analytics:**
- **Global:** `GET /api/analytics/overall/global?dateFrom=...&dateTo=...&company=...`
- **Personal:** `GET /api/analytics/overall/personal?userId=...&dateFrom=...&dateTo=...`

**Employee dropdown:** `GET /api/analytics/employees?company=...&department=...` (filtered by company/department when set)

---

### 5.3 What Each Filter Affects

| Filter | Learning Analytics | Overall Analytics |
|--------|--------------------|-------------------|
| **View (Global)** | All user-progress records (optionally filtered) | All users, holidays, news, events, announcements |
| **View (Personal)** | Only that employee's user-progress | Holidays, news, events, announcements (filtered by company) |
| **Date From / To** | `last_accessed_at` on user-progress | `publishedAt` on news/events/announcements/notifications |
| **Department** | Only progress for users in that department | Not used (Overall API ignores it) |
| **Company** | Only progress for users with that company | News/events/announcements filtered by company |

---

### 5.4 Date Filter Fields (Not `created_at`)

Date From / Date To use **different fields** per dashboard:

| Dashboard | Content Type | Date Field Used | Meaning |
|-----------|--------------|-----------------|---------|
| **Learning Analytics** | User Progress | `last_accessed_at` | When the user last accessed/worked on the course |
| **Overall Analytics** | News, Events, Announcements, Holidays | `publishedAt` | When the content was published (Strapi draft/publish) |
| **Quiz** (Learning) | Quiz Submissions | `submitted_at` | When the quiz was submitted |

**Note:** `created_at` (when the record was first created) is **not** used for filtering.

---

### 5.5 When Data Loads

- **Global view:** Data loads immediately when you open the dashboard
- **Personal view:** Data loads only after you select an employee. Until then, you see: *"Select an employee to view personal analytics"*
- **Filter change:** Changing any filter (View, Employee, Date, Department, Company) triggers a new API call and reloads all charts

---

## 6. Plugin Structure

```
src/plugins/analytics-dashboard/
├── strapi-admin.js          # Admin entry
├── strapi-server.js        # API routes
├── admin/src/
│   ├── index.js            # Plugin registration, menu links
│   ├── pluginId.js
│   ├── pages/
│   │   ├── LearningAnalytics/
│   │   └── OverallAnalytics/
│   ├── components/         # StatCard, DonutChart, BarChart, LineChart, DataTable, Filters, EmployeeSelector
│   └── hooks/useAnalytics.js
```

**Dependencies:** `recharts` (charts). Strapi provides React, Design System, Icons.

---

## 6. Security (Production)

1. **Enable authentication** on analytics routes in `strapi-server.js`: `auth: { scope: ['authenticated'] }`
2. **API Token:** Use a read-only Strapi API token if exposing endpoints externally
3. **CORS:** Configure allowed origins in `config/middlewares.js` if needed

---

## 8. Troubleshooting

### Analytics & Dashboards

| Issue | Solution |
|-------|----------|
| 404 on `/api/analytics/*` | Ensure analytics-dashboard plugin is enabled in `config/plugins.js` |
| Menu links not visible | Grant **Access Analytics Dashboard** permission to your role |
| Empty data / "No data available" | Check date filters; ensure `user-progress` and related content have `status: published` |
| `userId` filter not working | Ensure employees API returns `id` field |
| Charts not rendering | Run `npm install` to ensure recharts is installed |

### Build Errors (EPERM / spawn)

If `npm run build` fails with **`spawn EPERM`** or similar:

| Cause | Solution |
|-------|----------|
| OneDrive path / spaces | Move project to `C:\Projects\ui-lm-portal-backend` (no spaces) |
| Permission denied | Run terminal as Administrator |
| Antivirus | Temporarily disable or add exclusions for project folder, `node_modules`, Node.js |
| Cache corruption | Delete `build` and `node_modules\.strapi`, then `npm install` and `npm run build` |
| Node.js version | Strapi 5 expects Node.js 20–24 (`node -v`) |

**Move project (recommended):**
```bash
xcopy "C:\Users\DELL\OneDrive\Desktop\AIA-Vega project\UI-LM_Portal\ui-lm_portal_backend" "C:\Projects\ui-lm-portal-backend" /E /I /H
cd C:\Projects\ui-lm-portal-backend
npm install
npm run build
```

---

## 9. Requirements

- Node.js v20+
- Strapi v5
- No Docker, MySQL, or Redis needed

---

*Last updated: January 2025*
