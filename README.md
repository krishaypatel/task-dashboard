# Task Dashboard

A lightweight, mobile-friendly task manager that runs as a static site.

## Privacy

This public repository intentionally ships with **zero personal tasks**. `DEFAULT_TASKS` is empty. Tasks added by a user are stored in that user's browser and are not committed back to GitHub automatically.

## Features

- Today, Priority, Shortest, Easiest, All, Topic, and Completed views
- Time-aware priority ordering using due dates and optional due times
- Overdue and due-today tasks automatically rise into High Priority
- **Move next 5 here** action to promote the next five ranked tasks into High Priority
- Progress counters and a recent-completion progress bar
- Completed tasks remain visible on the normal dashboard for 24 hours, then move out of the dashboard while remaining in the Completed archive
- Topic/section filtering
- Built-in sections plus **Other** and **Custom section** creation
- Custom sections automatically appear in all section dropdowns
- Add, edit, delete, complete, reopen, and reprioritize tasks
- Priority, estimated minutes, difficulty, section, due date, due time, timing note, and Today pin
- JSON export and merge-style JSON import
- Responsive desktop/mobile UI

## Storage and upgrades

The current app uses a permanent browser-storage contract:

- `localStorage`: `task_dashboard_master_v1`
- IndexedDB: `TaskDashboardMasterDB`

Future releases should keep these identifiers unchanged.

On first upgrade, the app can recover data from known older dashboard storage keys and the older `TaskDashboardDB` IndexedDB database. It merges matching tasks rather than replacing the whole list, then writes the result into the permanent storage location. Once permanent storage exists, it becomes the source of truth so old data is not repeatedly re-imported.

This is **browser-side persistence, not cloud sync**. Data normally stays with the browser/origin where the app is used.

## Data shape

A task can contain:

```json
{
  "id": "unique-id",
  "title": "Example task",
  "priority": 2,
  "minutes": 15,
  "difficulty": 1,
  "category": "Projects",
  "due": "Soon",
  "dueDate": "2026-09-10",
  "dueTime": "17:00",
  "today": false,
  "focus": false,
  "done": false,
  "createdAt": 1789080000000,
  "updatedAt": 1789080000000,
  "completedAt": null
}
```

Priority values: `0` urgent, `1` next, `2` soon, `3` flexible.

Difficulty values: `0` very easy, `1` easy, `2` medium, `3` hard.

## Hosting

The project is fully static (`index.html`, `styles.css`, and `app.js`) and can be hosted on GitHub Pages, Cloudflare Pages, Netlify, Vercel, or another static host.

For GitHub Pages, publish the repository's `main` branch from the repository root.
