import {repository} from '@loopback/repository';
import {inject, service} from '@loopback/core';
import {get, post, requestBody, Response, RestBindings} from '@loopback/rest';
import {MailerService} from '../services/mailer.service';



import {UserRepository} from '../repositories/user.repository';
import {User} from '../models/user.model';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

const TOKEN_COOKIE = 'token';

export class AuthController {
  constructor(
    @repository(UserRepository) private userRepo: UserRepository,
    @inject(RestBindings.Http.RESPONSE) private res: Response,
    @service(MailerService) private mailer: MailerService) {}

  @post('/auth/register')
  async register(
    @requestBody({
      required: true,
      content: {'application/json': { schema: {
        type: 'object',
        required: ['email','password'],
        properties: {
          email: {type:'string', format:'email'},
          password: {type:'string', minLength:6},
          firstName: {type:'string'},
          lastName: {type:'string'},
          middleName: {type:'string'},
          phone: {type:'string'},
          birthDate: {type:'string'},
          gender: {type:'string'},
          civilStatus: {type:'string'},
          houseNumber: {type:'string'},
          street: {type:'string'},
          purok: {type:'string'},
          barangayHall: {type:'string'},
          type: {type:'string', enum:['resident','staff']}
        }
      }}}})
    body: any,
  ) {
    const found = await this.userRepo.findOne({ where: { email: body.email } });
    if (found) return { ok: false, message: 'Email already in use' };
    const hash = await bcrypt.hash(body.password, 10);
    const user = await this.userRepo.create({
      email: body.email,
      password: hash,
      firstName: body.firstName,
      lastName: body.lastName,
      middleName: body.middleName,
      phone: body.phone,
      birthDate: body.birthDate,
      gender: body.gender,
      civilStatus: body.civilStatus,
      houseNumber: body.houseNumber,
      street: body.street,
      purok: body.purok,
      barangayHall: body.barangayHall,
      type: body.type,
    });
    const token = this.signToken(user);
    this.setAuthCookie(token);
    return { ok: true, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, type: (user as any).type || 'resident' } };
  }

  @post('/auth/login')
  async login(
    @requestBody({
      required: true,
      content: {'application/json': { schema: {
        type: 'object',
        required: ['email','password','userType'],
        properties: { email: {type:'string', format:'email'}, password: {type:'string'}, userType: {type:'string', enum:['resident','staff']} }
      }}}})
    body: {email: string; password: string; userType: 'resident' | 'staff'},
  ) {
    const user = await this.userRepo.findOne({ where: { email: body.email } });
    if (!user) return { ok: false, message: 'Invalid credentials' };
    const ok = await bcrypt.compare(body.password, user.password);
    if (!ok) return { ok: false, message: 'Invalid credentials' };
    const expectedType = body.userType || 'resident';
    const userType = (user as any).type || 'resident';
    if (expectedType !== userType) return { ok: false, message: 'Invalid credentials' };
    const token = this.signToken(user);
    this.setAuthCookie(token);
    return { ok: true, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, type: (user as any).type || 'resident' } };
  }

  @post('/auth/logout')
  async logout() {
    this.clearAuthCookie();
    return { ok: true };
  }

  @get('/auth/me')
  async me(@inject(RestBindings.Http.REQUEST) req: any) {
    const token = this.readTokenFromCookie(req);
    if (!token) return { authenticated: false };
    try {
      const payload = jwt.verify(token, this.jwtSecret()) as any;
      const user = await this.userRepo.findById(payload.sub).catch(() => null);
      if (!user) return { authenticated: false };
      return { authenticated: true, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, address: `${user.houseNumber} ${user.street}, ${user.purok}, ${user.barangayHall}`.toLowerCase().replace(/\b\w/g, char => char.toUpperCase()), type: (user as any).type || 'resident' } };
    } catch {
      return { authenticated: false };
    }
  }

  private signToken(user: User) {
    const payload = { sub: user.id, email: user.email, type: (user as any).type || 'resident' };
    return jwt.sign(payload, this.jwtSecret(), { expiresIn: '7d' });
  }

  private jwtSecret() { return process.env.JWT_SECRET || 'dev-secret-change-me'; }

  private setAuthCookie(token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    const cookie = [
      `${TOKEN_COOKIE}=${token}`,
      'Path=/',
      'HttpOnly',
      isProd ? 'SameSite=None; Secure' : 'SameSite=Lax',
      'Max-Age=604800',
    ].join('; ');
    this.res.setHeader('Set-Cookie', cookie);
  }

  private clearAuthCookie() {
    const isProd = process.env.NODE_ENV === 'production';
    const cookie = [
      `${TOKEN_COOKIE}=`,
      'Path=/',
      'HttpOnly',
      isProd ? 'SameSite=None; Secure' : 'SameSite=Lax',
      'Max-Age=0',
    ].join('; ');
    this.res.setHeader('Set-Cookie', cookie);
  }

  private readTokenFromCookie(req: any): string | null {
    const header: string = req.headers['cookie'] || '';
    const parts = header.split(';').map((s: string) => s.trim());
    for (const p of parts) if (p.startsWith(TOKEN_COOKIE + '=')) return p.substring(TOKEN_COOKIE.length + 1);
    return null;
  }
  @post('/auth/forgot', {
    responses: { '200': { description: 'Request accepted' } }
  })
  async forgotPassword(
    @requestBody({
      required: true,
      content: {'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } } }}
    }) body: { email: string }
  ) {
    const email = body.email?.trim().toLowerCase();
    if (!email) return { ok: false, message: 'Email is required' };

    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) { return { ok: false, message: 'Email not found' }; } // do not send if not registered

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const ttlMin = parseInt(process.env.RESET_CODE_TTL_MIN || '10', 10);
    const ttlMs = Math.max(1, ttlMin) * 60 * 1000;
    const expires = new Date(Date.now() + ttlMs).toISOString();
    await this.userRepo.updateById(user.id as any, { resetCode: code, resetCodeExpiresAt: expires });

    const html = `<p>Hello ${user.firstName || ''},</p><p>Your password reset code is: <b>${code}</b></p><p>This code expires in ${ttlMin} minutes.</p>`;
    try { await this.mailer.sendMail({ to: email, subject: 'Your password reset code', text: 'Code: ' + code, html }); }
    catch (_e) { return { ok: false, message: 'Failed to send email' }; }

    return { ok: true, expiresAt: expires, ttlSeconds: Math.floor((Date.parse(expires) - Date.now()) / 1000) };
  }

  @post('/auth/resend-code', {
    responses: {'200': {description: 'Resend reset code'}}
  })
  async resendCode(
    @requestBody({
      required: true,
      content: {'application/json': {schema: {
        type:'object',
        required:['email'],
        properties: { email: {type:'string', format:'email'} }
      }}}
    })
    body: {email: string}
  ) {
    const email = body.email?.trim().toLowerCase();
    if (!email) return { ok: false, message: 'Email is required' };
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return { ok: false, message: 'Email not found' };

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const ttlMin = parseInt(process.env.RESET_CODE_TTL_MIN || '10', 10);
    const ttlMs = Math.max(1, ttlMin) * 60 * 1000;
    const expires = new Date(Date.now() + ttlMs).toISOString();

    await this.userRepo.updateById(user.id as any, { resetCode: code, resetCodeExpiresAt: expires } as any);

    const html = `<p>Hello ${user.firstName || ''},</p>
      <p>Your password reset verification code is: <b>${code}</b></p>
      <p>This code expires in ${ttlMin} minutes.</p>`;

    try { 
      await this.mailer.sendMail({ to: email, subject: 'Your password reset code', text: 'Code: ' + code, html }); 
    } catch (_e) { 
      return { ok: false, message: 'Failed to send email' }; 
    }

    return { ok: true, expiresAt: expires, ttlSeconds: Math.floor((Date.parse(expires) - Date.now()) / 1000) };
  }



  @post('/auth/verify-code', {
    responses: {'200': {description: 'Verify reset code'}}
  })
  async verifyResetCode(
    @requestBody({
      required: true,
      content: {'application/json': {schema: {
        type: 'object',
        required: ['email','code'],
        properties: {
          email: {type:'string', format:'email'},
          code: {type:'string', minLength: 6, maxLength: 6}
        }
      } }}
    })
    body: { email: string; code: string }
  ) {
    const email = body.email?.trim().toLowerCase();
    const code = body.code?.trim();
    if (!email || !code) return { ok: false, message: 'Email and code are required' };

    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || !user.resetCode || !user.resetCodeExpiresAt) return { ok: false, message: 'Invalid code' };

    const now = Date.now();
    const exp = Date.parse(user.resetCodeExpiresAt);
    if (user.resetCode !== code || isNaN(exp) || exp < now) {
      return { ok: false, message: 'Invalid or expired code' };
    }
    return { ok: true };
  }

  @post('/auth/reset-password', {
    responses: {'200': {description: 'Reset password'}}
  })
  async resetPassword(
    @requestBody({
      required: true,
      content: {'application/json': {schema: {
        type:'object',
        required:['email','code','password'],
        properties: {
          email: {type:'string', format:'email'},
          code: {type:'string', minLength:6, maxLength:6},
          password: {type:'string', minLength:8}
        }
      }}}
    })
    body: {email: string; code: string; password: string}
  ) {
    const email = body.email?.trim().toLowerCase();
    const code = body.code?.trim();
    const password = body.password;

    if (!email || !code || !password) return { ok: false, message: 'Missing fields' };
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || !user.resetCode || !user.resetCodeExpiresAt) return { ok: false, message: 'Invalid request' };

    const now = Date.now();
    const exp = Date.parse(user.resetCodeExpiresAt);
    if (user.resetCode !== code || isNaN(exp) || exp < now) {
      return { ok: false, message: 'Invalid or expired code' };
    }

    // validate password similar to frontend: 8+ with upper/lower/number
    const valid = password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
    if (!valid) return { ok: false, message: 'Password does not meet complexity requirements' };

    const hashed = await bcrypt.hash(password, 10);
    await this.userRepo.updateById(user.id as any, {
      password: hashed,
      resetCode: null as any,
      resetCodeExpiresAt: null as any
    } as any);

    return { ok: true };
  }

  // ===== Staff Forgot Password Flow (staffId-based) =====
  @post('/auth/forgot-staff', {
    responses: {'200': {description: 'Initiate password reset for staff via staffId'}}
  })
  async forgotStaff(
    @requestBody({
      required: true,
      content: {'application/json': {schema: {
        type:'object',
        required:['staffId'],
        properties: { staffId: {type:'string'} }
      }}},
    }) body: {staffId: string},
    @inject(RestBindings.Http.RESPONSE) res: Response,
  ) {
    const {staffId} = body;
    const user = await this.userRepo.findOne({ where: { staffId } });
    if (!user) return { ok: false, message: 'Staff not found' };

    // Reuse existing logic to create code & ttl
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await this.userRepo.updateById(user.id as any, { resetCode: code, resetCodeExpiresAt: expires } as any);

    try {
      await this.mailer.sendMail({ to: user.email, subject: 'Your password reset code', text: 'Code: ' + code, html: `<p>Your verification code is <b>${code}</b>. It expires in 15 minutes.</p>` });
    } catch (_e) {
      return { ok: false, message: 'Failed to send email' };
    }

    return { ok: true, expiresAt: expires, ttlSeconds: Math.floor((Date.parse(expires) - Date.now()) / 1000) };
  }

  @post('/auth/resend-code-staff', {
    responses: {'200': {description: 'Resend reset code for staff'}}
  })
  async resendCodeStaff(
    @requestBody({
      required: true,
      content: {'application/json': {schema: {
        type:'object',
        required:['staffId'],
        properties: { staffId: {type:'string'} }
      }}},
    }) body: {staffId: string},
  ) {
    const user = await this.userRepo.findOne({ where: { staffId: body.staffId } });
    if (!user) return { ok: false, message: 'Staff not found' };

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await this.userRepo.updateById(user.id as any, { resetCode: code, resetCodeExpiresAt: expires } as any);
    try {
      await this.mailer.sendMail({ to: user.email, subject: 'Your password reset code', text: 'Code: ' + code, html: `<p>Your verification code is <b>${code}</b>. It expires in 15 minutes.</p>` });
    } catch (_e) { /* swallow */ }
    return { ok: true, expiresAt: expires };
  }

  @post('/auth/verify-code-staff', {
    responses: {'200': {description: 'Verify reset code for staff'}}
  })
  async verifyCodeStaff(
    @requestBody({
      required: true,
      content: {'application/json': {schema: {
        type:'object',
        required:['staffId','code'],
        properties: { staffId: {type:'string'}, code: {type:'string'} }
      }}},
    }) body: {staffId: string, code: string},
  ) {
    const user = await this.userRepo.findOne({ where: { staffId: body.staffId } });
    if (!user) return { ok: false, message: 'Invalid staff' };
    if (!user.resetCode || !user.resetCodeExpiresAt) return { ok: false, message: 'No code requested' };
    if (user.resetCode !== body.code) return { ok: false, message: 'Invalid code' };
    if (Date.parse(user.resetCodeExpiresAt) < Date.now()) return { ok: false, message: 'Code expired' };
    return { ok: true };
  }

  @post('/auth/reset-password-staff', {
    responses: {'200': {description: 'Reset password for staff using code'}}
  })
  async resetPasswordStaff(
    @requestBody({
      required: true,
      content: {'application/json': {schema: {
        type:'object',
        required:['staffId','code','password'],
        properties: { staffId: {type:'string'}, code: {type:'string'}, password: {type:'string'} }
      }}},
    }) body: {staffId: string, code: string, password: string}
  ) {
    const user = await this.userRepo.findOne({ where: { staffId: body.staffId } });
    if (!user) return { ok: false, message: 'Invalid staff' };
    if (!user.resetCode || !user.resetCodeExpiresAt) return { ok: false, message: 'No code requested' };
    if (user.resetCode !== body.code) return { ok: false, message: 'Invalid code' };
    if (Date.parse(user.resetCodeExpiresAt) < Date.now()) return { ok: false, message: 'Code expired' };

    const password = body.password ?? '';
    const valid = password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
    if (!valid) return { ok: false, message: 'Password does not meet complexity requirements' };

    const hashed = await bcrypt.hash(password, 10);
    await this.userRepo.updateById(user.id as any, { password: hashed, resetCode: null as any, resetCodeExpiresAt: null as any } as any);
    return { ok: true };
  }

}
