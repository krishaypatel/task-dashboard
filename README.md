# Task Dashboard

A lightweight, mobile-friendly task manager that runs entirely in the browser.

## Privacy

This public repository intentionally ships with **zero personal tasks**. The app starts empty. Tasks you add are stored in the current browser's `localStorage`; they are not committed back to GitHub automatically.

## Features

- Today, Priority, Shortest, Easiest, and All views
- Check tasks off and automatically move them to Completed
- Add, edit, and delete tasks
- Priority, estimated time, difficulty, category, due/timing, and Today flag
- Mobile-responsive UI
- Browser-local persistence
- Export task data to JSON
- Import a JSON task list

## Use it with an AI

You can give `index.html` to an AI and ask it to customize the interface, or have the AI generate a task-list JSON file for you to import.

A task object uses this shape:

```json
{
  "id": "unique-id",
  "title": "Example task",
  "priority": 2,
  "minutes": 15,
  "difficulty": 1,
  "category": "Other",
  "due": "Soon",
  "today": false,
  "done": false
}
```

Priority values: `0` urgent, `1` next, `2` soon, `3` flexible.

Difficulty values: `0` very easy, `1` easy, `2` medium, `3` hard.

## Hosting

`index.html` is a fully static site and can be hosted on GitHub Pages, Cloudflare Pages, Netlify, Vercel, or any other static host.

For GitHub Pages, publish the repository's `main` branch from the repository root.
