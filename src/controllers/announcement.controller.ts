import {repository} from '@loopback/repository';
import {
  post,
  response,
  requestBody,
  getModelSchemaRef,
  get,
  param,
  patch,
} from '@loopback/rest';
import {Announcement} from '../models';
import {inject} from '@loopback/core';
import {RestBindings, Response} from '@loopback/rest';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
const ANN_UPLOAD_DIR = path.resolve(process.cwd(), '../upload/storage/announcements');
import {AnnouncementRepository} from '../repositories';
export class AnnouncementController {
  constructor(
    @inject(RestBindings.Http.RESPONSE) private res: Response,
    @repository(AnnouncementRepository)
    public announcementRepository: AnnouncementRepository,
  ) {}

  @post('/announcements')
  @response(200, {
    description: 'Announcement model instance',
    content: {'application/json': {schema: getModelSchemaRef(Announcement)}},
  })
  async create(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Announcement, {title: 'NewAnnouncement', partial: true}),
        },
      },
    })
    body: Partial<Announcement>,
  ): Promise<Announcement> {
    const nowIso = new Date().toISOString() as any;
    body.createdAt = nowIso;
    body.updatedAt = nowIso;
    return this.announcementRepository.create(body as Announcement);
  }

  @get('/announcements/{id}')
  @response(200, {
    description: 'Get announcement by id',
    content: {'application/json': {schema: getModelSchemaRef(Announcement)}},
  })
  async findById(@param.path.string('id') id: string): Promise<Announcement> {
    return this.announcementRepository.findById(id);
  }

  // Drafts (anything not published, includes scheduled)
  @get('/announcements/drafts')
  @response(200, {
    description: 'List draft announcements (published != true)',
    content: {
      'application/json': {
        schema: {type: 'array', items: getModelSchemaRef(Announcement, {includeRelations: false})},
      },
    },
  })
  async listDrafts(): Promise<Announcement[]> {
    return this.announcementRepository.find({
      where: {published: {neq: true}, publishedSchedule: {eq: null}},
      order: ['updatedAt DESC'],
    });
  }

  // Scheduled (not published but with schedule)
  @get('/announcements/scheduled')
  @response(200, {
    description: 'List scheduled announcements (published=false AND publishedSchedule present)',
    content: {
      'application/json': {
        schema: {type: 'array', items: getModelSchemaRef(Announcement, {includeRelations: false})},
      },
    },
  })
  async listScheduled(): Promise<Announcement[]> {
    return this.announcementRepository.find({
      where: {and: [{published: false}, {publishedSchedule: {neq: undefined}}]},
      order: ['publishedSchedule ASC'],
    });
  }

  // ✅ NEW: Published only
  @get('/announcements/published')
  @response(200, {
    description: 'List published announcements (published = true), newest first',
    content: {
      'application/json': {
        schema: {type: 'array', items: getModelSchemaRef(Announcement, {includeRelations: false})},
      },
    },
  })
  async listPublished(): Promise<Announcement[]> {
    return this.announcementRepository.find({
      where: {published: true},
      order: ['updatedAt DESC'],
    });
  }

  @patch('/announcements/{id}')
  @response(200, {
    description: 'Update announcement',
    content: {'application/json': {schema: getModelSchemaRef(Announcement)}},
  })
  async update(
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Announcement, {title: 'UpdateAnnouncement', partial: true}),
        },
      },
    })
    body: Partial<Announcement>,
  ): Promise<Announcement> {
    body.updatedAt = new Date().toISOString() as any;
    await this.announcementRepository.updateById(id, body);
    return this.announcementRepository.findById(id);
  }

  // Upload an announcement image
  @post('/announcements/upload')
  @response(200, {
    description: 'Upload an image for announcements',
    content: {'application/json': {schema: {type: 'object', properties: {
      ok: {type: 'boolean'},
      url: {type: 'string'},
      filename: {type: 'string'},
      message: {type: 'string'}
    }}}},
  })
  async uploadImage(
    @requestBody.file()
    req: any,
  ): Promise<object> {
    fs.mkdirSync(ANN_UPLOAD_DIR, {recursive: true});
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, ANN_UPLOAD_DIR),
      filename: (_req, file, cb) => {
        const ts = Date.now();
        const safe = String(file.originalname || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${ts}-${safe}`);
      },
    });
    const upload = multer({storage}).single('image');
    await new Promise<void>((resolve, reject) => {
      upload(req, this.res, (err: any) => (err ? reject(err) : resolve()));
    });
    const file = (req as any).file;
    if (!file) return {ok: false, message: 'No file uploaded'} as any;
    const filename = file.filename;
    const url = `/announcements/assets/${filename}`;
    return {ok: true, url, filename};
  }

  // Serve uploaded image
  @get('/announcements/assets/{filename}')
  @response(200, { description: 'Announcement image' })
  async getAsset(
    @param.path.string('filename') filename: string,
  ): Promise<Response> {
    const filePath = path.join(ANN_UPLOAD_DIR, filename);
     if (!fs.existsSync(filePath)) {
    this.res.status(404).end();
    return this.res;                       // <— return Response on 404 too
  }
    const ext = path.extname(filename).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png' :
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
          'application/octet-stream';

    // headers (optional cache headers for perf)
    this.res.setHeader('Content-Type', mime);
    this.res.setHeader('Cache-Control', 'public, max-age=3600, immutable');

    // Option A: sendFile (simplest)
    this.res.sendFile(filePath);
    return this.res;
  }
}
