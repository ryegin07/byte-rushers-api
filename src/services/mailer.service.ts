import {injectable, BindingScope} from '@loopback/core';
// Using require to avoid TS type dependency on nodemailer
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodemailer: any = require('nodemailer');


export interface MailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

@injectable({scope: BindingScope.SINGLETON})
export class MailerService {
  private transporter: any;
  private from: string;

  constructor() {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
    const user = process.env.SMTP_USER || 'ryegin07@gmail.com';
    const pass = process.env.SMTP_PASS || 'wiew vpyg aslk ejns';
    this.from = process.env.SMTP_FROM || user || 'Byte Rushers <byte-rushers@gmail.com>';

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {user, pass},
      });
    } else {
      // Fallback mock for development if SMTP config is missing
      this.transporter = {
        sendMail: async (opts: any) => {
          console.log('MAIL (dev fallback):', opts);
          return true;
        },
      };
    }
  }

  async send(options: MailOptions) {
    const {to, subject, text, html} = options;
    return this.transporter.sendMail({from: this.from, to, subject, text, html});
  }

  // Alias maintained for compatibility with existing calls
  async sendMail(options: MailOptions) {
    return this.send(options);
  }
}
