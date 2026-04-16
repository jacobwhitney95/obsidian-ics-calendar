export interface CalendarConfig {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
}

export interface OutlookEmailConfig {
  enabled: boolean;
  imapHost: string;
  imapPort: number;
  username: string;
  password: string;
  pollIntervalMinutes: number;
  showToast: boolean;
}

export interface ICSCalendarSettings {
  calendars: CalendarConfig[];
  syncIntervalMinutes: number;
  notificationLeadMinutes: number;
  showObsidianToast: boolean;
  dailyNoteFolder: string;
  dailyNoteFormat: string;
  openSidebarOnStartup: boolean;
  email: OutlookEmailConfig;
}

export const DEFAULT_SETTINGS: ICSCalendarSettings = {
  calendars: [],
  syncIntervalMinutes: 15,
  notificationLeadMinutes: 10,
  showObsidianToast: true,
  dailyNoteFolder: '',
  dailyNoteFormat: 'YYYY-MM-DD',
  openSidebarOnStartup: true,
  email: {
    enabled: false,
    imapHost: 'outlook.office365.us',
    imapPort: 993,
    username: '',
    password: '',
    pollIntervalMinutes: 5,
    showToast: true,
  },
};
