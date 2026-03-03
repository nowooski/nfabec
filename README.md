# EC Canvass

A browser-based political canvassing tool for the El Cerrito campaign. No server required — runs entirely in the browser with data stored in localStorage.

## Features

### Admin Dashboard
- Voter database with CSV import (auto-detects election history columns)
- Deduplication on re-import using voter registration number
- Walk list builder with filters for street, precinct, party, and per-election vote history
- Printable walk sheets (landscape format with support score circles, yard sign/DNC checkboxes, and notes column)
- Reports: precinct breakdown, street coverage, volunteer activity, election participation rates
- Team management with PIN-based authentication

### Mobile Canvasser View
- Dark-themed interface optimized for outdoor phone use
- Tap-to-record: outcome (Spoke / Not Home / Refused), support score 1–5, yard sign request, DNC flag, notes
- Walk list progress tracking with address grouping
- Voter history visible at the door

### Election History
- Imports all election participation columns from your voter file
- Interactive column picker during import (auto-detected + manual selection)
- Filter voters and build walk lists based on specific election participation
- Per-election checkboxes with AND logic (e.g., "voted in 2022 General AND 2024 Primary")

## Getting Started

1. Open `index.html` in a browser (or deploy to GitHub Pages)
2. Log in with default credentials: **admin** / **1234**
3. Import your voter CSV file
4. Create volunteer accounts in the Team tab
5. Build walk lists and assign them to volunteers
6. Volunteers log in on their phones to get the mobile canvassing interface

## Deployment

### Vercel (recommended)
1. Push this repo to GitHub
2. Import the repo in Vercel — it auto-detects Vite
3. Deploy. Done.

### Local Development
```bash
npm install
npm run dev
```

### Build for Production
```bash
npm run build
# Output in dist/
```

## Data

All data is stored in the browser's localStorage. Data persists across sessions but is specific to the browser/device. There is no server component.

## Default Login

| Username | PIN  | Role  |
|----------|------|-------|
| admin    | 1234 | Admin |

Create additional volunteer and admin accounts in the Team tab.
