import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ICSCalendarSettings, DEFAULT_SETTINGS } from './settings';
import { ICSCalendarSettingTab } from './settingsTab';
import { CalendarView, CALENDAR_VIEW_TYPE } from './CalendarView';
import { SyncManager } from './sync';
import { NotificationScheduler } from './notify';
import { EmailPoller } from './email';

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
