# Why Employee Table Shows All Zeros

## Root Cause: ID Mismatch or No Data

The Employee Table displays users but shows **0** for all metrics when:

1. **No data exists** – No user-progress or quiz-submission records (seed failed or wasn't run)
2. **ID mismatch** – Users use numeric `id` but relations store `documentId` (UUID), so filtering/grouping fails

## Current Solution (v2)

The analytics service now:
1. **Fetches ALL user-progress and quiz-submission** (no user filter) – same as Learning Global
2. **Filters in memory** – Keeps only records where the user matches our user list (by id, documentId, or document_id)
3. **Groups by user** – Maps progress/submission to users using all identifier types

## Verify Data Exists

Run the diagnostic script:
```bash
npm run check:employee-data
```

If it shows 0 user-progress and 0 quiz-submissions, run:
```bash
npm run seed:portal
```
