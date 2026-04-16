# ICS Calendar Sync — Obsidian Plugin

A self-contained Obsidian desktop plugin that:

- Syncs ICS/iCal calendar feeds (Office 365, Google Calendar, etc.) to your daily notes
- Shows a sidebar month grid + today's timeline view
- Fires **native Windows notifications** for upcoming events
- Monitors your **Outlook inbox via IMAP** for new emails — no Outlook desktop app, no Azure registration required

---

## Features

| Feature | Details |
|---|---|
| ICS sync | Fetches any `.ics` URL or local file; add/update/remove diffing per daily note |
| Sidebar view | Month calendar grid + scrollable today timeline with color-coded events |
| Event notifications | Native OS toast (via Electron) with configurable lead time |
| Email notifications | IMAP polling — works with Office 365 (.us gov included), Exchange, Gmail |
| Timezone support | Handles Outlook's Windows timezone names (`Eastern Standard Time`, etc.) |
| No external dependencies | Zero npm runtime packages; uses Obsidian + Node built-ins only |

---

## Local Installation (Manual)

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [Git](https://git-scm.com/)
- Obsidian desktop (v1.4.0+)

### Steps

**1. Clone the repo**

```bash
git clone https://github.com/YOUR_USERNAME/obsidian-ics-calendar.git
cd obsidian-ics-calendar
```

**2. Install dev dependencies**

```bash
npm install
```

**3. Set the output path**

Open `esbuild.config.mjs` and update `PLUGIN_OUT` to point to your vault's plugin folder:

```js
// esbuild.config.mjs  — top of file
const PLUGIN_OUT = '/absolute/path/to/your/vault/.obsidian/plugins/obsidian-ics-calendar';
```

On Windows, use a forward-slash path or escape backslashes:
```js
const PLUGIN_OUT = 'C:/Users/YourName/Documents/MyVault/.obsidian/plugins/obsidian-ics-calendar';
```

**4. Build**

```bash
npm run build
```

This compiles TypeScript → `main.js` and copies `manifest.json` + `styles.css` directly into your vault's plugin folder.

**5. Enable in Obsidian**

1. Open Obsidian → Settings → Community Plugins
2. Turn off **Safe Mode** if prompted
3. Find **ICS Calendar Sync** and enable it

> After any code change, run `npm run build` again and reload the plugin in Obsidian  
> (`Ctrl+P` → *Reload app without saving*, or disable → re-enable in settings).

---

## Configuration

Open **Settings → ICS Calendar Sync**:

### Calendars

Click **+ Add calendar** and fill in:
- **Name** — display label
- **URL** — your `.ics` feed URL (e.g. from Outlook → Share calendar → ICS link)
- **Color** — used in the sidebar timeline
- **Enabled** toggle

Multiple calendars are supported.

### Email Notifications (IMAP)

Polls your inbox for unread emails without requiring Outlook desktop or an Azure app registration.

| Field | Example |
|---|---|
| IMAP server | `outlook.office365.us` (gov) or `outlook.office365.com` (commercial) |
| Port | `993` |
| Email address | `you@yourorg.com` |
| Password | Your password, or an [App Password](https://account.microsoft.com/security) if MFA is on |

Click **Test IMAP connection** to verify before enabling polling.

---

## Development

```bash
# Watch mode — rebuilds on every file save
npm run dev
```

Source files:

| File | Purpose |
|---|---|
| `src/main.ts` | Plugin entry point, lifecycle, polling |
| `src/sync.ts` | ICS fetch + daily note diffing |
| `src/parser.ts` | Zero-dependency ICS parser with Windows timezone support |
| `src/notify.ts` | Electron native notifications + scheduler |
| `src/email.ts` | IMAP email polling client |
| `src/CalendarView.ts` | Sidebar month grid + today timeline |
| `src/settingsTab.ts` | Settings UI |
| `src/settings.ts` | TypeScript interfaces + defaults |
| `src/utils.ts` | Date helpers, daily note path resolution |
| `styles.css` | All UI styles (Obsidian CSS variables only) |

---

## License

MIT. See [LICENSE](LICENSE).
