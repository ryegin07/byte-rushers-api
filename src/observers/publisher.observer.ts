// src/observers/publisher.observer.ts
import {inject, lifeCycleObserver, LifeCycleObserver} from '@loopback/core';
import {repository} from '@loopback/repository';
import {AnnouncementRepository, UserRepository} from '../repositories';
import {Announcement} from '../models/announcement.model';
import {User} from '../models/user.model';

@lifeCycleObserver('server')
export class PublisherObserver implements LifeCycleObserver {
  private timer?: NodeJS.Timeout;

  constructor(
    @repository(AnnouncementRepository)
    private announcementRepo: AnnouncementRepository,
    @repository(UserRepository)
    private userRepo: UserRepository,
    @inject('services.MailerService', {optional: true})
    private mailer?: any,
    @inject('services.SmsService', {optional: true})
    private sms?: any,
  ) {}

  start(): void {
    // Check every 60 seconds
    this.timer = setInterval(() => {
      void this.processDueAnnouncements();
    }, 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async processDueAnnouncements() {
    const now = new Date();
    // 1) Find announcements that should be published
    const due: Announcement[] = await this.announcementRepo.find({
      where: {
        and: [
          {published: false as any},
          {publishedSchedule: {lte: now} as any},
        ],
      },
    });

    if (!due.length) return;

    // 2) Publish them individually and notify
    for (const ann of due) {
      try {
        await this.announcementRepo.updateById(ann.id!, {
          published: true as any,
          updatedAt: new Date() as any,
        } as Partial<Announcement>);

        // Notify residents according to their preferences
        await this.notifyResidents(ann);
      } catch (e) {
        console.error('[PublisherObserver] Failed publishing/notification for', ann?.id, e);
      }
    }
  }

  private async notifyResidents(announcement: Announcement) {
    // Fetch recipients: residents with verified email
    const residents: User[] = await this.userRepo.find({
      where: {
        and: [
          {emailVerified: true as any},
          {type: 'resident' as any},
        ],
      },
      fields: {id: true, email: true, fullName: true, firstName: true, lastName: true, phone: true, enableEmailNotif: true, enableSMSNotif: true} as any,
    });

    if (!residents.length) return;

    const subject = `[Announcement] ${announcement.title}`;
    const bodyHtml = this.buildHtmlBody(announcement);

    // Send notifications best-effort; do not throw to keep loop healthy
    await Promise.all(residents.map(async (u) => {

      const prefsEmail = u.enableEmailNotif;
      const prefsSMS = u.enableSMSNotif;
      const email = u.email ? u.email.trim() : null;
      const phone = u.phone ? this.normalizePH(u.phone) : null;

      // Email
      if (prefsEmail && email && this.mailer) {
        await this.trySendMail(email, subject, bodyHtml);
      }

      // SMS
      if (prefsSMS && phone && this.sms) {
        await this.trySendSms(phone, this.buildSmsBody(announcement));
      }
    }));
  }

  private buildHtmlBody(a: Announcement): string {
    return `
      <h2 style="margin:0 0 8px 0">${this.escapeHtml(a.title || '')}</h2>
      <div>${this.nl2br(this.escapeHtml(a.content || ''))}</div>
      ${(a as any).hall ? `<p><strong>Location:</strong> ${this.escapeHtml((a as any).hall)}</p>` : ''}
      ${(a as any).eventDate ? `<p><strong>When:</strong> ${this.escapeHtml(String((a as any).eventDate))}</p>` : ''}
      ${(a as any).eventTime ? `<p><strong>Time:</strong> ${this.escapeHtml(String((a as any).eventTime))}</p>` : ''}
    `;
  }

  private buildSmsBody(a: Announcement): string {
    const title = a.title ? `${a.title}: ` : '';
    const content = (a.content || '').replace(/\s+/g, ' ').trim();
    // Keep SMS concise (<= 300 chars)
    return (title + content + '\n Check your email for more details.').slice(0, 300);
  }

  private async trySendMail(to: string, subject: string, html: string) {
    try {
      if (this.mailer?.sendMail) {
        await this.mailer.sendMail({to, subject, html});
      } else if (this.mailer?.send) {
        await this.mailer.send({to, subject, html});
      } else {
        console.warn('[PublisherObserver] MailerService not available or missing send method.');
      }
    } catch (e) {
      console.warn('[PublisherObserver] Email send failed to', to, e);
    }
  }

  private async trySendSms(to: string, message: string) {
    try {
      if (this.sms?.send) {
        await this.sms.send(to, message);
      } else if (this.sms?.sendSMS) {
        await this.sms.sendSMS(to, message);
      } else if (this.sms?.sendSms) {
        await this.sms.sendSms(to, message);
      } else {
        console.warn('[PublisherObserver] SmsService not available or missing send method.');
      }
    } catch (e) {
      console.warn('[PublisherObserver] SMS send failed to', to, e);
    }
  }

  private escapeHtml(str: string) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private nl2br(str: string) {
    return String(str).replace(/\n/g, '<br/>');
  }

  private normalizePH(num: string): string {
    if (!num) return num;
    let n = num.trim();
    if (n.startsWith('+')) return n;
    if (n.startsWith('09')) return '+63' + n.slice(1);
    if (n.length === 10 && n.startsWith('9')) return '+63' + n;
    if (n.startsWith('63')) return '+' + n;
    return '+' + n.replace(/^\+/, '');
  }
}
