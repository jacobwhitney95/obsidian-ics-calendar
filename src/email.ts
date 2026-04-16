import { Notice } from 'obsidian';
import type ICSCalendarPlugin from './main';
import { fireNativeNotification } from './notify';

// ─── Minimal IMAP client (TLS, no external deps) ─────────────────────────────
//
// Uses Node's built-in `tls` module — already available inside Obsidian's
// Electron runtime. Connects, checks UNSEEN messages, disconnects cleanly.
// Works with Office 365 / Exchange Online including .us government tenants.
// No app registration required — just email + password or app password.

interface IMAPMessage {
  uid: string;
  subject: string;
  from: string;
}

/** Run a full IMAP session: login → check UNSEEN → logout → return messages. */
function imapCheckUnseen(
  host: string,
  port: number,
  user: string,
  pass: string,
): Promise<IMAPMessage[]> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tls = require('tls') as typeof import('tls');

    const messages: IMAPMessage[] = [];
    let buf = '';
    let tag = 0;
    let seqNums: string[] = [];
    let fetching = 0;
    let done = false;

    const nextTag = () => `A${++tag}`;

    const socket = tls.connect({ host, port, rejectUnauthorized: true }, () => {
      // Connection established — server sends greeting, we wait for it
    });

    socket.setTimeout(15_000);
    socket.on('timeout', () => { socket.destroy(new Error('IMAP timeout')); });
    socket.on('error', reject);

    socket.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\r\n');
      buf = lines.pop() ?? ''; // last incomplete line goes back into buffer

      for (const line of lines) {
        handleLine(line);
      }
    });

    socket.on('close', () => {
      if (!done) resolve(messages);
    });

    function send(cmd: string) {
      socket.write(cmd + '\r\n');
    }

    function handleLine(line: string) {
      // Server greeting
      if (line.startsWith('* OK') && tag === 0) {
        send(`${nextTag()} LOGIN "${user.replace(/"/g, '\\"')}" "${pass.replace(/"/g, '\\"')}"`);
        return;
      }

      // LOGIN response
      if (line.startsWith(`A${tag} OK`) && tag === 1) {
        send(`${nextTag()} SELECT INBOX`);
        return;
      }

      // SELECT INBOX response
      if (line.startsWith(`A${tag} OK`) && tag === 2) {
        send(`${nextTag()} SEARCH UNSEEN`);
        return;
      }

      // SEARCH result
      if (line.startsWith('* SEARCH')) {
        const parts = line.slice(9).trim().split(' ').filter(Boolean);
        seqNums = parts;
        return;
      }

      // SEARCH complete
      if (line.startsWith(`A${tag} OK`) && tag === 3) {
        if (seqNums.length === 0) {
          logout();
          return;
        }
        // Fetch ENVELOPE for up to 20 newest
        const toFetch = seqNums.slice(-20).join(',');
        fetching = Math.min(seqNums.length, 20);
        send(`${nextTag()} FETCH ${toFetch} (UID ENVELOPE)`);
        return;
      }

      // FETCH response lines — parse UID and ENVELOPE
      if (line.startsWith('* ') && line.includes('ENVELOPE')) {
        const uid = extractField(line, 'UID') ?? String(Math.random());
        const env = line.match(/ENVELOPE\s+\(/i)?.[0];
        let subject = '(No Subject)';
        let from = 'Unknown';

        if (env) {
          // ENVELOPE format: (date subject from sender reply-to to cc bcc in-reply-to message-id)
          // Extract via minimal bracket parser
          const inner = extractEnvelopeInner(line);
          if (inner) {
            const fields = parseEnvelopeFields(inner);
            subject = decodeImapString(fields[1]) || '(No Subject)';
            const fromField = fields[2];
            from = parseAddress(fromField) || 'Unknown';
          }
        }

        messages.push({ uid, subject, from });

        fetching--;
        if (fetching <= 0) {
          // May still get the tagged OK, handle it below
        }
        return;
      }

      // FETCH complete
      if (line.startsWith(`A${tag} OK`) && tag === 4) {
        logout();
        return;
      }

      // Any tagged NO/BAD
      if (line.match(/^A\d+ (NO|BAD)/)) {
        done = true;
        socket.destroy(new Error(`IMAP error: ${line}`));
        reject(new Error(line));
        return;
      }
    }

    function logout() {
      done = true;
      send(`${nextTag()} LOGOUT`);
      setTimeout(() => {
        socket.destroy();
        resolve(messages);
      }, 500);
    }
  });
}

// ── ENVELOPE parsing helpers ───────────────────────────────────────────────

function extractField(line: string, field: string): string | null {
  const re = new RegExp(`${field}\\s+(\\S+)`, 'i');
  const m = line.match(re);
  return m ? m[1] : null;
}

function extractEnvelopeInner(line: string): string | null {
  const start = line.toUpperCase().indexOf('ENVELOPE (');
  if (start < 0) return null;
  let depth = 0;
  let i = start + 9; // position of '('
  const result: string[] = [];
  while (i < line.length) {
    const ch = line[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) break; }
    result.push(ch);
    i++;
  }
  return result.slice(1).join('');
}

function parseEnvelopeFields(inner: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && inner[i] === ' ') i++;
    if (inner[i] === '"') {
      // Quoted string
      i++;
      let s = '';
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === '\\') i++;
        s += inner[i++];
      }
      i++; // closing quote
      fields.push(s);
    } else if (inner[i] === '(') {
      // Nested list — return raw
      let depth = 0;
      let s = '';
      while (i < inner.length) {
        if (inner[i] === '(') depth++;
        else if (inner[i] === ')') { depth--; if (depth === 0) { s += inner[i++]; break; } }
        s += inner[i++];
      }
      fields.push(s);
    } else if (inner.slice(i, i + 3).toUpperCase() === 'NIL') {
      fields.push('');
      i += 3;
    } else {
      let s = '';
      while (i < inner.length && inner[i] !== ' ' && inner[i] !== ')') s += inner[i++];
      fields.push(s);
    }
  }
  return fields;
}

function parseAddress(raw: string): string {
  // Address list format: ((name NIL mailbox host) ...)
  const m = raw.match(/\(\s*"?([^"()NIL][^"()]*)"?\s+NIL\s+"?([^"\s()]+)"?\s+"?([^"\s()]+)"?/i);
  if (m) {
    const name = decodeImapString(m[1]).trim();
    const addr = `${m[2]}@${m[3]}`;
    return name && name !== 'NIL' ? name : addr;
  }
  return '';
}

function decodeImapString(s: string): string {
  if (!s) return '';
  // RFC 2047 encoded-word: =?charset?encoding?text?=
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    try {
      if (enc.toUpperCase() === 'B') {
        const bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      } else {
        // Q encoding
        const qtext = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g,
          (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
        return qtext;
      }
    } catch {
      return text;
    }
  });
}

// ─── EmailPoller class ────────────────────────────────────────────────────────

export class EmailPoller {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private seenUids = new Set<string>();
  private initialised = false;

  constructor(private plugin: ICSCalendarPlugin) {}

  start() {
    this.stop();
    const s = this.plugin.settings.email;
    if (!s.enabled || !s.username || !s.password) return;

    const ms = Math.max(1, s.pollIntervalMinutes) * 60_000;
    this.pollInterval = setInterval(() => this.poll(), ms);
    this.poll();
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /** Called from settings tab Test button. */
  async initiateAuth() {
    const s = this.plugin.settings.email;
    if (!s.username || !s.password) {
      new Notice('⚠️ Enter your email and password in settings first.', 6000);
      return;
    }
    new Notice('📧 Testing IMAP connection…', 3000);
    try {
      const msgs = await imapCheckUnseen(s.imapHost, s.imapPort, s.username, s.password);
      new Notice(`✅ IMAP connected — ${msgs.length} unread message(s) in inbox.`, 6000);
    } catch (e) {
      new Notice(`⚠️ IMAP connection failed: ${(e as Error).message}`, 8000);
    }
  }

  private async poll() {
    const s = this.plugin.settings.email;
    if (!s.username || !s.password) return;

    try {
      const messages = await imapCheckUnseen(s.imapHost, s.imapPort, s.username, s.password);

      if (!this.initialised) {
        messages.forEach((m) => this.seenUids.add(m.uid));
        this.initialised = true;
        return;
      }

      for (const msg of messages) {
        if (this.seenUids.has(msg.uid)) continue;
        this.seenUids.add(msg.uid);
        this.notifyEmail(msg);
      }
    } catch (e) {
      console.warn('[ICS Calendar] IMAP poll error:', e);
    }
  }

  private notifyEmail(msg: IMAPMessage) {
    const title = `📧 ${msg.subject}`;
    const body = `From: ${msg.from}`;

    const fired = fireNativeNotification(title, body);
    if (!fired || this.plugin.settings.email.showToast) {
      new Notice(`${title}\n${body}`, 10_000);
    }
  }
}
