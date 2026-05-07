import { Plugin, WorkspaceLeaf, Notice, requestUrl, moment, TFile } from 'obsidian';
import { ICSCalendarSettings, DEFAULT_SETTINGS } from './settings';
import { ICSCalendarSettingTab } from './settingsTab';
import { CalendarView, CALENDAR_VIEW_TYPE } from './CalendarView';
import { SyncManager } from './sync';
import { NotificationScheduler } from './notify';
import { EmailPoller } from './email';
import { parseICS } from './parser';
import { isSameDay, getDailyNotePath } from './utils';

export default class ICSCalendarPlugin extends Plugin {
  settings!: ICSCalendarSettings;
  syncManager!: SyncManager;
  notifier!: NotificationScheduler;
  emailPoller!: EmailPoller;

  private syncIntervalId: ReturnType<typeof setInterval> | null = null;

  async onload() {
    await this.loadSettings();

    // Register the sidebar view
    this.registerView(
      CALENDAR_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new CalendarView(leaf, this),
    );

    // Ribbon icon — toggles sidebar
    this.addRibbonIcon('calendar-days', 'ICS Calendar', () =>
      this.toggleCalendarView(),
    );

    // Commands
    this.addCommand({
      id: 'sync-now',
      name: 'Sync Now',
      callback: () => this.syncNow(),
    });

    this.addCommand({
      id: 'toggle-sidebar',
      name: 'Toggle Sidebar',
      callback: () => this.toggleCalendarView(),
    });

    this.addCommand({
      id: 'debug-sync',
      name: 'Debug Sync (show diagnostics)',
      callback: () => this.debugSync(),
    });

    // Settings tab
    this.addSettingTab(new ICSCalendarSettingTab(this.app, this));

    // Managers
    this.syncManager = new SyncManager(this);
    this.notifier = new NotificationScheduler(this);
    this.emailPoller = new EmailPoller(this);

    // Wait for workspace to be ready
    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.openSidebarOnStartup) {
        await this.activateCalendarView();
      }

      // Delay first sync slightly so ICS plugin (if running alongside) can finish loading
      setTimeout(async () => {
        await this.syncNow();
        this.startPolling();

        if (this.settings.email.enabled) {
          this.emailPoller.start();
        }
      }, 3000);
    });
  }

  onunload() {
    this.stopPolling();
    this.notifier.stop();
    this.emailPoller.stop();
    this.app.workspace.detachLeavesOfType(CALENDAR_VIEW_TYPE);
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Deep merge email config
    this.settings.email = Object.assign(
      {},
      DEFAULT_SETTINGS.email,
      this.settings.email,
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Restart polling so new interval takes effect
    this.stopPolling();
    this.startPolling();
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  private startPolling() {
    const ms = Math.max(1, this.settings.syncIntervalMinutes) * 60_000;
    this.syncIntervalId = setInterval(() => this.syncNow(), ms);
  }

  private stopPolling() {
    if (this.syncIntervalId !== null) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  async syncNow() {
    try {
      await this.syncManager.sync();
      // Notify other plugins / Dataview queries
      this.app.workspace.trigger('calendar-sync-complete' as never);
      this.refreshCalendarView();
    } catch (e) {
      console.error('[ICS Calendar] Sync failed:', e);
    }
  }

  async debugSync() {
    const today = new Date();
    const lines: string[] = [
      `# ICS Calendar Debug — ${today.toLocaleString()}`,
      `Local timezone offset: UTC${-today.getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-today.getTimezoneOffset() / 60}`,
      `Today (local): ${today.toLocaleDateString()} ${today.toLocaleTimeString()}`,
      '',
    ];

    if (this.settings.calendars.length === 0) {
      lines.push('⚠️ No calendars configured in settings.');
    }

    for (const cal of this.settings.calendars) {
      lines.push(`## Calendar: "${cal.name}" (${cal.enabled ? 'enabled' : 'DISABLED'})`);
      if (!cal.enabled) { lines.push(''); continue; }

      try {
        const bustUrl = cal.url + (cal.url.includes('?') ? '&' : '?') + '_t=' + Date.now();
        const resp = await requestUrl({ url: bustUrl, method: 'GET' });
        lines.push(`- Fetch: ✅ ${resp.text.length} bytes, HTTP ${resp.status}`);

        const allEvents = parseICS(resp.text);
        lines.push(`- Total events parsed: ${allEvents.length}`);

        // Show date range of feed
        if (allEvents.length > 0) {
          const sorted = [...allEvents].sort((a, b) => a.start.getTime() - b.start.getTime());
          lines.push(`- Feed date range: ${sorted[0].start.toLocaleDateString()} → ${sorted[sorted.length - 1].start.toLocaleDateString()}`);
        }

        const todayEvents = allEvents.filter((e) => isSameDay(e.start, today));
        lines.push(`- Events on today (${today.toLocaleDateString()}): ${todayEvents.length}`);

        if (todayEvents.length > 0) {
          lines.push('', '### Today\'s events:');
          for (const ev of todayEvents) {
            lines.push(`- ${ev.summary} | start: ${ev.start.toLocaleString()} (UTC: ${ev.start.toISOString()}) | allDay: ${ev.allDay}`);
          }
        } else if (allEvents.length > 0) {
          lines.push('', '### Sample event dates (first 5):');
          for (const ev of allEvents.slice(0, 5)) {
            lines.push(`- ${ev.summary} | start: ${ev.start.toLocaleString()} (UTC: ${ev.start.toISOString()})`);
          }
        }

        const notePath = getDailyNotePath(this.app, this.settings, moment(today));
        lines.push('', `- Daily note path: \`${notePath}\``);
        const noteFile = this.app.vault.getAbstractFileByPath(notePath);
        lines.push(`- Daily note exists: ${noteFile ? 'yes' : 'no'}`);

      } catch (e) {
        lines.push(`- ❌ ERROR: ${(e as Error).message}`);
      }
      lines.push('');
    }

    // Write to vault
    const outPath = 'ics-debug.md';
    const content = lines.join('\n');
    const existing = this.app.vault.getAbstractFileByPath(outPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(outPath, content);
    }

    // Open it
    const file = this.app.vault.getAbstractFileByPath(outPath) as TFile;
    await this.app.workspace.getLeaf(true).openFile(file);
    new Notice('📋 Debug output written to ics-debug.md', 4000);
  }

  // ── Sidebar management ─────────────────────────────────────────────────────

  async activateCalendarView() {
    if (this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE).length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
      }
    }

    const leaves = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  toggleCalendarView() {
    const leaves = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE);
    if (leaves.length > 0) {
      leaves.forEach((l) => l.detach());
    } else {
      this.activateCalendarView();
    }
  }

  refreshCalendarView() {
    this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE).forEach((leaf) => {
      (leaf.view as CalendarView).refresh();
    });
  }
}
