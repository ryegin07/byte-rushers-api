import {post, requestBody, response} from '@loopback/rest';
import {MailerService} from '../services/mailer.service';

export class SupportController {
  private mailer: MailerService;
  constructor() {
    this.mailer = new MailerService();
  }

  @post('/support/email')
  @response(200, {description: 'Send support email'})
  async sendSupportEmail(
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name','email','message'],
            properties: {
              name: {type: 'string'},
              email: {type: 'string', format: 'email'},
              subject: {type: 'string'},
              message: {type: 'string'}
            }
          }
        }
      }
    })
    body: {name: string, email: string, subject?: string, message: string}
  ): Promise<{ok: boolean}> {
    const to = process.env.SUPPORT_EMAIL || process.env.MAIL_TO || 'vincentsanjoaquin07@gmail.com';
    const subject = (body.subject && body.subject.trim()) ? body.subject.trim() : `[Quick Contact] Message from ${body.name}`;
    const safeMsg = (body.message || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const html = `<p><strong>From:</strong> ${body.name} &lt;${body.email}&gt;</p><p>${safeMsg.replace(/\n/g,'<br/>')}</p>`;
    const text = `From: ${body.name} <${body.email}>\n\n${body.message || ''}`;

    await this.mailer.send({to, subject, text, html});
    return {ok: true};
  }
}
