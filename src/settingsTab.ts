import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ICSCalendarPlugin from './main';
import { CalendarConfig } from './settings';

export class ICSCalendarSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ICSCalendarPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl: el } = this;
    el.empty();
    el.createEl('h2', { text: 'ICS Calendar Sync' });

    // ── Calendars ────────────────────────────────────────────────────────────

    el.createEl('h3', { text: 'Calendars' });

    for (const cal of this.plugin.settings.calendars) {
      this.addCalendarEntry(el, cal);
    }

    new Setting(el).addButton((btn) =>
      btn
        .setButtonText('+ Add Calendar')
        .setCta()
        .onClick(() => {
          this.plugin.settings.calendars.push({
            id: `cal-${Date.now()}`,
            name: 'My Calendar',
            url: '',
            color: '#7c3aed',
            enabled: true,
          });
          this.plugin.saveSettings();
          this.display();
        }),
    );

    // ── Sync ─────────────────────────────────────────────────────────────────

    el.createEl('h3', { text: 'Sync' });

    new Setting(el)
      .setName('Sync interval (minutes)')
      .setDesc('How often to re-fetch calendars while Obsidian is open.')
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange((v) => {
            this.plugin.settings.syncIntervalMinutes = Math.max(1, parseInt(v) || 15);
            this.plugin.saveSettings();
          }),
      );

    new Setting(el)
      .setName('Open sidebar on startup')
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.openSidebarOnStartup)
          .onChange((v) => {
            this.plugin.settings.openSidebarOnStartup = v;
            this.plugin.saveSettings();
          }),
      );

    // ── Daily Note ───────────────────────────────────────────────────────────

    el.createEl('h3', { text: 'Daily Note' });
    el.createEl('p', {
      cls: 'setting-item-description',
      text: 'Leave folder blank to use vault root. These are overridden by the core Daily Notes plugin if it is active.',
    });

    new Setting(el)
      .setName('Folder')
      .addText((t) =>
        t
          .setPlaceholder('e.g. Journal')
          .setValue(this.plugin.settings.dailyNoteFolder)
          .onChange((v) => {
            this.plugin.settings.dailyNoteFolder = v.trim();
            this.plugin.saveSettings();
          }),
      );

    new Setting(el)
      .setName('Date format')
      .setDesc('moment.js format string')
      .addText((t) =>
        t
          .setValue(this.plugin.settings.dailyNoteFormat)
          .onChange((v) => {
            this.plugin.settings.dailyNoteFormat = v.trim() || 'YYYY-MM-DD';
            this.plugin.saveSettings();
          }),
      );

    // ── Notifications ─────────────────────────────────────────────────────────

    el.createEl('h3', { text: 'Notifications' });

    new Setting(el)
      .setName('Lead time (minutes)')
      .setDesc('How many minutes before the event to fire the notification.')
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.notificationLeadMinutes))
          .onChange((v) => {
            this.plugin.settings.notificationLeadMinutes = Math.max(1, parseInt(v) || 10);
            this.plugin.saveSettings();
          }),
      );

    new Setting(el)
      .setName('Also show Obsidian toast')
      .setDesc(
        'Show an in-app notice alongside the native Windows notification.',
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showObsidianToast)
          .onChange((v) => {
            this.plugin.settings.showObsidianToast = v;
            this.plugin.saveSettings();
          }),
      );

    new Setting(el).addButton((btn) =>
      btn.setButtonText('Test notification now').onClick(() => {
        const { fireNativeNotification } = require('./notify');
        const ok = fireNativeNotification(
          '📅 ICS Calendar Test',
          'Native Windows notifications are working!',
        );
        if (!ok) new Notice('Electron notifications unavailable — using Obsidian toasts.', 5000);
      }),
    );

    // ── Outlook Email ─────────────────────────────────────────────────────────

    el.createEl('h3', { text: 'Outlook Email Notifications' });
    el.createEl('p', {
      cls: 'setting-item-description',
      text: 'Polls your Outlook inbox via IMAP for new unread emails. No app registration required — just your email and password (or an app password if MFA is enabled). Works with Office 365 including .us government tenants.',
    });

    const em = this.plugin.settings.email;

    new Setting(el)
      .setName('Enable email notifications')
      .addToggle((t) =>
        t.setValue(em.enabled).onChange((v) => {
          em.enabled = v;
          this.plugin.saveSettings();
          this.display();
        }),
      );

    if (em.enabled) {
      new Setting(el)
        .setName('IMAP server')
        .setDesc('Office 365 US: outlook.office365.us · Commercial: outlook.office365.com')
        .addText((t) =>
          t
            .setValue(em.imapHost)
            .onChange((v) => { em.imapHost = v.trim(); this.plugin.saveSettings(); }),
        );

      new Setting(el)
        .setName('IMAP port')
        .setDesc('993 (TLS — recommended)')
        .addText((t) =>
          t
            .setValue(String(em.imapPort))
            .onChange((v) => { em.imapPort = parseInt(v) || 993; this.plugin.saveSettings(); }),
        );

      new Setting(el)
        .setName('Email address')
        .addText((t) =>
          t
            .setPlaceholder('you@pmdautomation.com')
            .setValue(em.username)
            .onChange((v) => { em.username = v.trim(); this.plugin.saveSettings(); }),
        );

      new Setting(el)
        .setName('Password / App password')
        .setDesc('If MFA is on, generate an App Password in your Microsoft account security settings.')
        .addText((t) => {
          t.inputEl.type = 'password';
          t
            .setValue(em.password)
            .onChange((v) => { em.password = v; this.plugin.saveSettings(); });
        });

      new Setting(el)
        .setName('Poll interval (minutes)')
        .addText((t) =>
          t
            .setValue(String(em.pollIntervalMinutes))
            .onChange((v) => {
              em.pollIntervalMinutes = Math.max(1, parseInt(v) || 5);
              this.plugin.saveSettings();
            }),
        );

      new Setting(el)
        .setName('Also show Obsidian toast')
        .addToggle((t) =>
          t.setValue(em.showToast).onChange((v) => { em.showToast = v; this.plugin.saveSettings(); }),
        );

      new Setting(el)
        .setName('Test connection')
        .setDesc('Connects to your IMAP server and reports unread count.')
        .addButton((btn) =>
          btn
            .setButtonText('Test IMAP connection')
            .setCta()
            .onClick(() => this.plugin.emailPoller.initiateAuth()),
        );
    }
  }

  private addCalendarEntry(containerEl: HTMLElement, cal: CalendarConfig) {
    const s = new Setting(containerEl)
      .setName('')
      .addToggle((t) =>
        t.setValue(cal.enabled).onChange((v) => {
          cal.enabled = v;
          this.plugin.saveSettings();
        }),
      )
      .addText((t) =>
        t
          .setPlaceholder('Calendar name')
          .setValue(cal.name)
          .onChange((v) => { cal.name = v; this.plugin.saveSettings(); }),
      )
      .addText((t) => {
        t.inputEl.style.width = '260px';
        t
          .setPlaceholder('https://… or vault/path.ics')
          .setValue(cal.url)
          .onChange((v) => { cal.url = v.trim(); this.plugin.saveSettings(); });
      })
      .addColorPicker((c) =>
        c.setValue(cal.color).onChange((v) => { cal.color = v; this.plugin.saveSettings(); }),
      )
      .addButton((btn) =>
        btn
          .setIcon('trash')
          .setWarning()
          .setTooltip('Remove calendar')
          .onClick(() => {
            this.plugin.settings.calendars =
              this.plugin.settings.calendars.filter((c) => c.id !== cal.id);
            this.plugin.saveSettings();
            this.display();
          }),
      );

    // Show the calendar name in the setting header dynamically
    s.nameEl.setText(cal.name || 'Unnamed Calendar');
  }
}
