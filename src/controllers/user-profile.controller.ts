
import {inject, service} from '@loopback/core';
import {get, patch, requestBody, RestBindings, HttpErrors} from '@loopback/rest';
import {UserRepository} from '../repositories/user.repository';
import {repository} from '@loopback/repository';
import * as jwt from 'jsonwebtoken';
import {MailerService} from '../services/mailer.service';

const TOKEN_COOKIE = 'token';
const API_BASE = process.env.APP_BASE_URL || 'http://127.0.0.1:3001';

export class UserProfileController {
  constructor(
    @repository(UserRepository) private userRepo: UserRepository,
    @inject(RestBindings.Http.REQUEST) private req: any,
    @service(MailerService) private mailer: MailerService,
  ) {}

  private readTokenFromCookie(req: any): string | null {
    const header: string = req.headers['cookie'] || '';
    const parts = header.split(';').map((s: string) => s.trim());
    for (const p of parts) if (p.startsWith(TOKEN_COOKIE + '=')) return decodeURIComponent(p.substring(TOKEN_COOKIE.length + 1));
    return null;
  }
  private jwtSecret() { return process.env.JWT_SECRET || 'dev-secret-change-me'; }

  @get('/users/me')
  async me() {
    const token = this.readTokenFromCookie(this.req);
    if (!token) return {authenticated:false};
    let payload: any;
    try { payload = jwt.verify(token, this.jwtSecret()); } catch { return {authenticated:false}; }
    const user = await this.userRepo.findById(payload.sub).catch(()=>null);
    if (!user) return {authenticated:false};
    return {authenticated:true, user};
  }

  @patch('/users/me', { responses: { '200': { description: 'Updated profile' } } })
  async updateMe(
    @requestBody({
      required: true,
      content: {'application/json': { schema: {
        type: 'object',
        properties: {
          email: {type:'string'},
          firstName: {type:'string'},
          lastName: {type:'string'},
          phone: {type:'string'},
          occupation: {type:'string'},
          houseNumber: {type:'string'},
          street: {type:'string'},
          purok: {type:'string'},
          barangayHall: {type:'string'},
          civilStatus: {type:'string'},
          birthDate: {type:'string'},
          emergencyContact: {type:'string'},
          emergencyPhone: {type:'string'},
          avatar: {type:'string'},
          hall: {type:'string'}
        }
      } } }
    }) body: any
  ){
    const token = this.readTokenFromCookie(this.req);
    if (!token) throw new HttpErrors.Unauthorized('Not authenticated');
    let payload: any;
    try { payload = jwt.verify(token, this.jwtSecret()); } catch { throw new HttpErrors.Unauthorized('Invalid token'); }
    const id = payload.sub as string;

    const current = await this.userRepo.findById(id);
    const update: any = {};

    // Detect email change
    let emailChanged = false;
    if (typeof body.email === 'string' && body.email.trim() && body.email.trim().toLowerCase() !== current.email.toLowerCase()) {
      update.email = body.email.trim().toLowerCase();
      update.emailVerified = false;
      const token = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 48);
      const expires = new Date(Date.now() + 24*60*60*1000).toISOString();
      update.verificationToken = token;
      update.verificationExpires = expires;
      emailChanged = true;
      // Send verification
      const verifyLink = `${API_BASE}/auth/verify?token=${encodeURIComponent(token)}`;
      try {
        await this.mailer.sendMail({
          to: update.email,
          subject: 'Verify your new email',
          html: `<p>Hi ${current.firstName || ''},</p>
                 <p>Please verify your new email by clicking the link below:</p>
                 <p><a href="${verifyLink}" target="_blank" rel="noopener">Verify Email</a></p>
                 <p>This link expires in 24 hours.</p>`
        });
      } catch (e) {
        // If email sending fails, still update but let client know
      }
    }

    // Simple scalar updates
    const scalars = ['firstName','lastName','phone','occupation','houseNumber','street','purok','barangayHall','civilStatus','birthDate','emergencyContact','emergencyPhone','avatar','hall', 'middleName', 'enableEmailNotif', 'enableSMSNotif'];
    for (const k of scalars) {
      if (k in body && typeof body[k] !== 'undefined') update[k] = body[k];
    } 

    // Compute fullName from firstName/lastName (prefer updated values)
    const firstName = (typeof update.firstName === 'string' ? update.firstName : current.firstName) || '';
    const lastName  = (typeof update.lastName  === 'string' ? update.lastName  : current.lastName ) || '';
    const combined = `${firstName} ${lastName}`.trim().replace(/\s+/g, ' ');
    if (combined) update.fullName = combined;

    // Compute address from houseNumber, street, purok, barangayHall
    const houseNumber = (typeof update.houseNumber === 'string' ? update.houseNumber : current.houseNumber) || '';
    const street = (typeof update.street === 'string' ? update.street : current.street) || '';
    const purok = (typeof update.purok === 'string' ? update.purok : current.purok) || '';
    const barangayHall = (typeof update.barangayHall === 'string' ? update.barangayHall : current.barangayHall) || '';
    const addrParts: string[] = [];
    const left = `${houseNumber} ${street}`.trim();
    if (left) addrParts.push(left);
    if (purok) addrParts.push(purok);
    if (barangayHall) addrParts.push(barangayHall);
    if (addrParts.length) update.address = addrParts.join(', ');

    await this.userRepo.updateById(id, update);
    const user = await this.userRepo.findById(id);
    return { ok: true, user, emailVerificationSent: emailChanged };
  }
}
