import {inject,service} from '@loopback/core';
import {DataObject, repository} from '@loopback/repository';
import {
  get,
  getModelSchemaRef,
  post,
  Request,
  requestBody,
  response,
  RestBindings,
  param,
  Response,
} from '@loopback/rest';
import multer from 'multer';
import path from 'path';
import QRCode from 'qrcode';

import {Submission} from '../models';
import {SubmissionRepository} from '../repositories';
import {MongodbDataSource} from '../datasources';
import {CounterService} from '../services/counter.service';
import {SmsService} from '../services/sms.service';
import { MailerService } from '../services';

const smsEnabled = (process.env.SMS_ENABLED || 'true').toLowerCase() === 'true';
export class SubmissionController {
  private counter: CounterService;
  private sms: SmsService;

  constructor(
    @repository(SubmissionRepository)
    public submissionRepository: SubmissionRepository,
    @inject('datasources.mongodb') private mongoDs: MongodbDataSource,
    @service(MailerService) private mailer: MailerService
  ) {
    this.counter = new CounterService(this.mongoDs);
    this.sms = new SmsService(this.mongoDs);
  }

  @post('/submissions')
  @response(200, {
    description: 'Submission model instance',
    content: { 'application/json': { schema: getModelSchemaRef(Submission) } },
  })
  async create(
    @requestBody({
      description: 'Create Submission via JSON',
      required: true,
      content: {
        'application/json': {
          schema: getModelSchemaRef(Submission, { title: 'NewSubmission', partial: true }),
        },
      },
    })
    submission: Partial<Submission>,
  ): Promise<Submission> {
    const submissionType = (submission.submissionType || 'Complaint').trim();

    // Generate IDs depending on type
    let complaintId = '';
    let documentReqId = (submission as any).documentReqId || '';
    if (submissionType.toLowerCase() === 'complaint') {
      complaintId = await this.generateComplaintId();
    } else if (submissionType.toLowerCase() === 'document') {
      // Ensure unique documentReqId
      if (documentReqId) {
        const exists = await this.submissionRepository.count({ documentReqId } as any);
        if (exists.count > 0) documentReqId = '';
      }
      if (!documentReqId) documentReqId = await this.generateDocumentId();
    }

    if (submissionType !== 'Document') {
      if (submission && typeof submission === 'object') {
        delete (submission as any).fee;
        delete (submission as any).urgent;
      }
    }
    const payload: Partial<Submission> = {
      ...submission,
      phone: submission?.phone ? normalizePH(String(submission.phone)) : submission?.phone,
      status: submission?.status,
      submissionType,
      complaintId,
      documentReqId, // ensure only once
    };

    const created = await this.submissionRepository.create(payload as DataObject<Submission>);
    await this.maybeSendSms(created);
    return created;
  }

  @post('/submissions/upload')
  @response(200, {
    description: 'Submission created with file',
    content: { 'application/json': { schema: getModelSchemaRef(Submission) } },
  })
  async createWithFile(
    @inject(RestBindings.Http.REQUEST) req: Request,
  ): Promise<Submission> {
    
    const fs = await import('fs'); const path = await import('path');
    const uploadDir = path.resolve(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, {recursive: true});

    const storage = multer.diskStorage({
      destination: (_req: any, _file: any, cb: (err: any, dest: string) => void) =>
        cb(null, uploadDir),
      filename: (_req: any, file: any, cb: (err: any, filename: string) => void) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, `sub-${unique}${ext}`);
      },
    });
    const upload = multer({ storage }).fields([{ name: 'evidence', maxCount: 1 }, { name: 'file', maxCount: 1 }]);

    const fields: any = await new Promise((resolve, reject) => {
      upload(req as any, {} as any, (err: any) => {
        if (err) return reject(err);
        resolve({ ...((req as any).body ?? {}), files: (req as any).files });
      });
    });

    const submissionType = (fields.submissionType || 'Complaint').trim();

    let complaintId = '';
    let documentReqId = String(fields.documentReqId || '');
    if (submissionType.toLowerCase() === 'complaint') {
      complaintId = await this.generateComplaintId();
    } else if (submissionType.toLowerCase() === 'document') {
      if (documentReqId) {
        const exists = await this.submissionRepository.count({ documentReqId } as any);
        if (exists.count > 0) documentReqId = '';
      }
      if (!documentReqId) documentReqId = await this.generateDocumentId();
    }

    const files: any = (fields as any).files || {};
    // Choose correct file field based on type
    let selectedFile: any = undefined;
    if (submissionType.toLowerCase() === 'complaint') {
      selectedFile = Array.isArray(files?.evidence) ? files.evidence[0] : undefined;
    } else if (submissionType.toLowerCase() === 'document') {
      selectedFile = Array.isArray(files?.file) ? files.file[0] : undefined;
    }
    const data: DataObject<Submission> = {
      name: fields.anonymous === 'true' ? 'Anonymous' : (fields.name ?? fields.complainantName ?? fields.requestorName),
      email: fields.anonymous === 'true' ? 'anonymous@example.com' : fields.email,
      phone: fields.phone ? normalizePH(String(fields.phone)) : fields.phone,
      address: fields.address,
      type: fields.type ?? fields.complaintType,
      priority: fields.priority,
      location: fields.location,
      hall: fields.hall,
      subject: fields.subject,
      message: fields.message ?? fields.description,
      anonymous: fields.anonymous === 'true' || fields.anonymous === true,
      smsNotifications: fields.smsNotifications === 'true' || fields.smsNotifications === true,
      evidenceUrl: submissionType.toLowerCase() === 'complaint' && selectedFile ? '/uploads/' + selectedFile.filename : undefined,
      fileUrl: submissionType.toLowerCase() === 'document' && selectedFile ? '/uploads/' + selectedFile.filename : undefined,
      status: fields.status,
      submissionType,
      complaintId,
      documentReqId,
      purpose: fields.purpose,
      documentType: fields.documentType,
      pickupHall: fields.pickupHall,
      fee: submissionType === 'Document' ? parseFloat(fields.fee) || 0 : undefined,
      urgent: submissionType === 'Document' ? (fields.urgent === 'true' || fields.urgent === true) : undefined,
      category: fields.category,
    };

    const created = await this.submissionRepository.create(data);
    await this.maybeSendSms(created);
    return created;
  }

  @get('/submissions')
  @response(200, {
    description: 'Array of Submission model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Submission, { includeRelations: true }),
        },
      },
    },
  })
  async find(): Promise<Submission[]> {
    return this.submissionRepository.find({ order: ['createdAt DESC'] });
  }

  // ---- helpers -------------------------------------------------------------

  private async generateComplaintId(): Promise<string> {
    const year = new Date().getFullYear();
    const key = `complaint-${year}`;
    const seq = await this.counter.next(key); // atomic counter in Mongo
    return `COMP-${year}-${String(seq).padStart(3, '0')}`;
  }

  private async generateDocumentId(): Promise<string> {
    const seq = await this.counter.next('documentReqId');
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const n = String(seq).padStart(4, '0');
    return `DOC-${y}${m}-${n}`;
  }

  private async maybeSendSms(sub: Submission) {
    try {
      if (!smsEnabled) return;
      if (!(sub as any).smsNotifications || !sub.phone) return;
      const t = (sub.submissionType || '').toLowerCase();
      if (t !== 'complaint' && t !== 'document') return;

      const who = (sub as any).name || (sub as any).requestorName || '';
      const ref = t === 'complaint' ? (sub as any).complaintId : (sub as any).documentReqId;
      const refText = ref ? ` (${ref})` : '';
      const text = t === 'complaint'
        ? `Ugnayan sa Manggahan: Hi ${who}. We have received your complaint (Ref ${refText}). We will send updates as it is reviewed.`
        : `Ugnayan sa Manggahan:: Hi ${who}. We have received your document request (Ref ${refText}). We will text you when processing starts and when it is ready for pickup.`;

      await this.sms.send(sub.phone!, text);
    } catch (e) {
      console.warn('[SubmissionController] Failed to send SMS:', e);
    }
  }

  private async sendSMSComplete(sub: Submission) {
    try {
      if (!smsEnabled) return;
      if (!(sub as any).smsNotifications || !sub.phone) return;
      const t = (sub.submissionType || '').toLowerCase();
      const st = (sub.status || '').toLowerCase();
      if (t !== 'complaint' && t !== 'inquiry' && t !== 'document') return;

      const who = (sub as any).name || (sub as any).requestorName || '';
      const ref = t === 'complaint' ? (sub as any).complaintId : (sub as any).documentReqId;
      const refText = ref ? ` (${ref})` : '';
      let text = '';
      if (t === 'complaint') {
        text = `Hi ${who}, your complaint ${refText} has been resolved. Thank you.`;
      } else if (t === 'document' && st === 'ready') {
        const qrCodeLink = `${process.env.APP_URL || 'http://127.0.0.1:3001'}/submissions/${sub.id}/qr`;
        text = `Hi ${who}, your document request ${refText} is now ready for pickup, QR code is sent to your email address. Please visit the municipal hall during working hours. Thank you.`;
        await this.mailer.sendMail({ 
          to: (sub as any).email, 
          subject: 'Your document request is ready for pickup',
          html: `<p>Hi ${who|| ''},</p>
           <p>Your document request ${refText} is now ready for pickup, download the QR Code by clicking the link below:</p>
           <p><a href="${qrCodeLink}" target="_blank" rel="noopener">Download QR</a></p>
           <p>Thank you.</p>`
        });
      } else if (t === 'document' && st === 'cancelled') {
        text = `Hi ${who}, your document request ${refText} has been cancelled. Thank you.`;
      }
      await this.sms.send(sub.phone!, text);
    } catch (e) {
      console.warn('[SubmissionController] Failed to send SMS:', e);
    }
  }

  @post('/submissions/{id}/status')
  @response(200, {
    description: 'Update submission status',
    content: {'application/json': {schema: getModelSchemaRef(Submission)}},
  })
  async updateStatus(
    @param.path.string('id') id: string,
    @requestBody({
      content: {'application/json': {schema: {type: 'object', properties: {status: {type: 'string'}}, required: ['status']}}}
    })
    body: {status: string},
  ): Promise<Submission> {
    const allowed = ['pending','ready','completed','active','resolved', 'cancelled', 'verification'];
    const s = (body.status || '').toLowerCase();
    if (!allowed.includes(s)) {
      throw Object.assign(new Error('Invalid status'), {statusCode: 400});
    }

    const update: any = {status: s};
    if (s === 'completed' || s === 'resolved') {
      update.dateCompleted = new Date().toISOString();
    }

    await this.submissionRepository.updateById(id, update as any);
    const sub = await this.submissionRepository.findById(id);
    await this.sendSMSComplete(sub);
    return this.submissionRepository.findById(id);
  }

  @get('/submissions/{id}/qr')
  @response(200, {
    description: 'QR code PNG for a Document submission',
    content: {'image/png': {schema: {type: 'string', format: 'binary'}}},
  })
  async getSubmissionQr(
    @param.path.string('id') id: string,
    @inject(RestBindings.Http.RESPONSE) res: Response,
  ): Promise<Buffer> {
    const sub = await this.submissionRepository.findById(id).catch(() => undefined as any);
    if (!sub) {
      throw Object.assign(new Error('Submission not found'), {statusCode: 404});
    }
    const type = ((sub as any).submissionType || (sub as any).type || '').toString().toLowerCase();
    if (type !== 'document' && type !== 'document request' && !type.includes('document')) {
      throw Object.assign(new Error('QR is only available for Document submissions'), {statusCode: 400});
    }
    const payload = {
      kind: 'barangay-document',
      documentId: (sub as any).id,
      title: (sub as any).title || (sub as any).subject || 'Document',
      resident: {
        id: (sub as any).residentId, // optional if present in submission
        fullName: (sub as any).name,
        email: (sub as any).email,
      },
      issuedAt: new Date().toISOString(),
    };
    const png = await QRCode.toBuffer(JSON.stringify(payload), {type: 'png', errorCorrectionLevel: 'M', width: 512});
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="Document-${(sub as any).id}-QR.png"`);
    return png;
  }

  @get('/submissions/document/{code}')
  @response(200, {
    description: 'Verify a document submission by code (documentReqId or id)',
    content: {'application/json': {schema: {type:'object'}}},
  })
  async verifyDocument(
    @param.path.string('code') code: string,
  ): Promise<object> {
    // Try by documentReqId first, then by id
    const whereAny: any = {
      or: [{documentReqId: code}, {id: code}],
      submissionType: {inq: ['Document','document','DOCUMENT']},
    };
    const sub = await this.submissionRepository.findOne({where: whereAny});
    if (!sub) {
      return { ok: false, message: 'Document not found' };
    }
    return {
      ok: true,
      data: {
        id: sub.id,
        documentReqId: (sub as any).documentReqId,
        title: (sub as any).title || (sub as any).subject,
        type: sub.documentType || 'Document',
        purpose: (sub as any).purpose,
        hall: (sub as any).hall || (sub as any).pickupHall,
        status: sub.status,
        issueDate: (sub as any).createdAt,
        expiryDate: (sub as any).expiryDate,
        fee: (sub as any).fee,
        resident: {
          name: sub.name,
          email: sub.email,
          address: sub.address,
          phone: sub.phone,
        },
      },
    };
  }

  @post('/submissions/{id}/complete')
  @response(200, {
    description: 'Mark a document submission as collected (status=completed)',
    content: {'application/json': {schema: {type:'object'}}},
  })
  async markCollected(
    @param.path.string('id') id: string,
  ): Promise<object> {
    const sub = await this.submissionRepository.findById(id).catch(() => null);
    if (!sub) return { ok:false, message: 'Not found' };
    await this.submissionRepository.updateById(id, {
      status: 'completed',
      dateCompleted: new Date().toISOString(),
    } as any);
    const updated = await this.submissionRepository.findById(id);
    return { ok:true, data: updated };
  }

  @post('/submissions/{id}/remarks')
  @response(200, {
    description: 'Update submission remarks',
    content: {'application/json': {schema: {type: 'object', properties: {ok: {type: 'boolean'}, data: {}}}}},
  })
  async updateRemarks(
    @param.path.string('id') id: string,
    @requestBody({
      required: true,
      content: {'application/json': {schema: {type: 'object', properties: {remarks: {type: 'string'}}, required: ['remarks']}}},
    })
    body: {remarks: string},
  ): Promise<object> {
    await this.submissionRepository.updateById(id, {remarks: body.remarks} as any);
    const updated = await this.submissionRepository.findById(id);
    return {ok: true, data: updated};
  }

}

function normalizePH(num: string): string {
  if (!num) return num;
  let n = num.trim();
  if (n.startsWith('+')) return n;
  if (n.startsWith('09')) return '+63' + n.slice(1);
  if (n.length === 10 && n.startsWith('9')) return '+63' + n;
  if (n.startsWith('63')) return '+' + n;
  return '+' + n.replace(/^\+/, '');
}
