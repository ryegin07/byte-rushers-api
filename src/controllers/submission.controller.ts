import {inject} from '@loopback/core';
import {DataObject, repository} from '@loopback/repository';
import {
  get,
  getModelSchemaRef,
  post,
  Request,
  requestBody,
  response,
  RestBindings,
} from '@loopback/rest';
import multer from 'multer';
import path from 'path';

import {Submission} from '../models';
import {SubmissionRepository} from '../repositories';
import {MongodbDataSource} from '../datasources';
import {CounterService} from '../services/counter.service';
import {SmsService} from '../services/sms.service';

export class SubmissionController {
  private counter: CounterService;
  private sms: SmsService;

  constructor(
    @repository(SubmissionRepository)
    public submissionRepository: SubmissionRepository,
    @inject('datasources.mongodb') private mongoDs: MongodbDataSource,
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
    // Determine type first
    const submissionType = (submission.submissionType ?? 'Complaint').trim();

    // Only generate IDs for Complaints
    const complaintId =
      submissionType.toLowerCase() === 'complaint'
        ? await this.generateComplaintId()
        : '';

    const payload: Partial<Submission> = {
      ...submission,
      submissionType,
      complaintId,
    };

    const created = await this.submissionRepository.create(payload as DataObject<Submission>);
    await this.maybeSendSms(created); // will no-op for Inquiry anyway
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
    const uploadDir = path.resolve(__dirname, '../../public/uploads');
    const storage = multer.diskStorage({
      destination: (_req: any, _file: any, cb: (err: any, dest: string) => void) =>
        cb(null, uploadDir),
      filename: (_req: any, file: any, cb: (err: any, filename: string) => void) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname || '');
        cb(null, unique + ext);
      },
    });
    const upload = multer({ storage }).single('evidence');

    const fields: any = await new Promise((resolve, reject) => {
      upload(req as any, {} as any, (err: any) => {
        if (err) return reject(err);
        resolve({ ...((req as any).body ?? {}), file: (req as any).file });
      });
    });

    const submissionType = (fields.submissionType || 'Complaint').trim();

    const complaintId =
      submissionType.toLowerCase() === 'complaint'
        ? await this.generateComplaintId()
        : '';

    const data: DataObject<Submission> = {
      name: fields.anonymous === 'true' ? 'Anonymous' : (fields.name ?? fields.complainantName),
      complaintId,
      email: fields.anonymous === 'true' ? 'anonymous@example.com' : fields.email,
      phone: fields.phone,
      address: fields.address,
      type: fields.type ?? fields.complaintType,
      priority: fields.priority,
      location: fields.location,
      hall: fields.hall,
      subject: fields.subject,
      message: fields.message ?? fields.description,
      anonymous: fields.anonymous === 'true' || fields.anonymous === true,
      smsNotifications: fields.smsNotifications === 'true' || fields.smsNotifications === true,
      evidenceUrl: fields.file ? '/uploads/' + fields.file.filename : undefined,
      submissionType,
    };

    const created = await this.submissionRepository.create(data);
    await this.maybeSendSms(created); // will no-op for Inquiry
    return created;
  }

  @get('/submissions')
  @response(200, {
    description: 'Array of Submission model instances',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: getModelSchemaRef(Submission, {includeRelations: true}),
        },
      },
    },
  })
  async find(): Promise<Submission[]> {
    return this.submissionRepository.find({order: ['createdAt DESC']});
  }

  // ---- helpers -------------------------------------------------------------

  private async generateComplaintId(): Promise<string> {
    const year = new Date().getFullYear();
    const key = `complaint-${year}`;
    const seq = await this.counter.next(key); // atomic counter in Mongo
    return `COMP-${year}-${String(seq).padStart(3, '0')}`;
  }

  private async maybeSendSms(sub: Submission) {
    try {
      const enabled = (process.env.SMS_ENABLED || 'true').toLowerCase() === 'true';
      if (!enabled) return;
      if (!(sub as any).smsNotifications || !sub.phone) return;
      if (!sub.submissionType || sub.submissionType.toLowerCase() !== 'complaint') return;

      const text = `Acknowledging receipt of your submission for ${sub.submissionType} with ID ${sub.complaintId}.`;
      await this.sms.send(normalizePH(sub.phone), text);
    } catch (e) {
      console.warn('[SubmissionController] Failed to send SMS:', e);
    }
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
