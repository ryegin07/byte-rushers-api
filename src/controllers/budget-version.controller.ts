
import {inject} from '@loopback/core';
import {
  get,
  post,
  patch,
  del,
  requestBody,
  response,
  RestBindings,
  Response,
  param,
  operation,
} from '@loopback/rest';
import {repository} from '@loopback/repository';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import type {Request} from 'express';
import {BudgetVersion} from '../models';
import {BudgetVersionRepository} from '../repositories';

const STORAGE_DIR = path.resolve(process.cwd(), '../upload/storage/budget');

// Narrow request type used after multer
interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
}
type UploadRequest = Request & { file?: UploadedFile; body?: { changes?: string } };

export class BudgetVersionController {
  constructor(
    @repository(BudgetVersionRepository) private bvRepo: BudgetVersionRepository,
    @inject(RestBindings.Http.RESPONSE) private res: Response,
  ) {
    fs.mkdirSync(STORAGE_DIR, {recursive: true});
  }

  @get('/budget-versions')
  @response(200, { description: 'List of budget versions (latest first)' })
  async list(): Promise<BudgetVersion[]> {
    return this.bvRepo.find({order: ['uploadedAt DESC']});
  }

  @get('/budget-versions/latest')
  @response(200, { description: 'Latest budget version metadata' })
  async latest(): Promise<BudgetVersion | null> {
    const items = await this.bvRepo.find({order: ['uploadedAt DESC'], limit: 1});
    return items[0] ?? null;
  }

  @get('/budget-versions/latest/download')
  @response(200, {
    description: 'Stream the latest PDF',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async latestDownload(): Promise<void> {
    const latest = await this.latest();
    if (!latest?.fileUrl) {
      this.res.status(404).send({ message: 'No budget report uploaded yet' });
      return;
    }

    if (!latest.fileUrl.startsWith('/')) {
      this.res.redirect(latest.fileUrl);
      return;
    }

    // build filesystem path like your snippet does
    const urlPath = latest.fileUrl.replace(/^[/\\]+/, '');
    const parent = path.resolve(process.cwd(), '..');
    const filePath = path.join(parent, urlPath);

    if (!fs.existsSync(filePath)) {
      this.res.status(404).json({ ok: false, message: 'File not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileName = latest.fileName || 'budget-report.pdf';

    this.res.setHeader('Content-Type', 'application/pdf');
    this.res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
    this.res.setHeader('Content-Length', String(stat.size));
    this.res.setHeader('Last-Modified', stat.mtime.toUTCString());
    this.res.setHeader('Accept-Ranges', 'bytes');
    this.res.setHeader('Cache-Control', 'public, max-age=3600, immutable');

    const stream = fs.createReadStream(filePath);
    if (typeof (this.res as any).flushHeaders === 'function') (this.res as any).flushHeaders();
    stream.on('error', () => {
      if (!this.res.headersSent) this.res.status(500);
      this.res.end();
    });
    stream.pipe(this.res);
  }

  @operation('head', '/budget-versions/latest/download')
  @response(200, { description: 'HEAD check for latest budget version' })
  async headLatest(): Promise<void> {
    const latest = await this.latest();
    if (!latest?.fileUrl?.startsWith('/')) {
      this.res.status(404).end();
      return;
    }
    const urlPath = latest.fileUrl.replace(/^[/\\]+/, '');
    const parent = path.resolve(process.cwd(), '..');
    const filePath = path.join(parent, urlPath);
    if (!fs.existsSync(filePath)) {
      this.res.status(404).end();
      return;
    }
    const stat = fs.statSync(filePath);
    this.res.setHeader('Content-Type', 'application/pdf');
    this.res.setHeader('Content-Length', String(stat.size));
    this.res.setHeader('Last-Modified', stat.mtime.toUTCString());
    this.res.setHeader('Accept-Ranges', 'bytes');
    this.res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    this.res.status(200).end();
  }


  @get('/budget-versions/{id}/download')
  @response(200, {
    description: 'Download specific version',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  async downloadById(@param.path.string('id') id: string): Promise<void> {
    const rec = await this.bvRepo.findById(id);
    if (!rec?.fileUrl) {
      this.res.status(404).send({ message: 'Not found' });
      return;
    }

    if (!rec.fileUrl.startsWith('/')) {
      this.res.redirect(rec.fileUrl);
      return;
    }

    const urlPath = rec.fileUrl.replace(/^[/\\]+/, '');
    const parent = path.resolve(process.cwd(), '..');
    const filePath = path.join(parent, urlPath);

    if (!fs.existsSync(filePath)) {
      this.res.status(404).json({ ok: false, message: 'File missing' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileName = rec.fileName || 'budget-report.pdf';

    this.res.setHeader('Content-Type', 'application/pdf');
    this.res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
    this.res.setHeader('Content-Length', String(stat.size));
    this.res.setHeader('Last-Modified', stat.mtime.toUTCString());
    this.res.setHeader('Accept-Ranges', 'bytes');
    this.res.setHeader('Cache-Control', 'public, max-age=3600, immutable');

    const stream = fs.createReadStream(filePath);
    if (typeof (this.res as any).flushHeaders === 'function') (this.res as any).flushHeaders();
    stream.on('error', () => {
      if (!this.res.headersSent) this.res.status(500);
      this.res.end();
    });
    stream.pipe(this.res);
  }

  @operation('head', '/budget-versions/{id}/download')
  @response(200, { description: 'HEAD check for a specific budget version' })
  async headDownloadById(@param.path.string('id') id: string): Promise<void> {
    const rec = await this.bvRepo.findById(id).catch(() => null);
    if (!rec?.fileUrl?.startsWith('/')) { this.res.status(404).end(); return; }
    const urlPath = rec.fileUrl.replace(/^[/\\]+/, '');
    const parent = path.resolve(process.cwd(), '..');
    const filePath = path.join(parent, urlPath);
    if (!fs.existsSync(filePath)) { this.res.status(404).end(); return; }
    const stat = fs.statSync(filePath);
    this.res.setHeader('Content-Type', 'application/pdf');
    this.res.setHeader('Content-Length', String(stat.size));
    this.res.setHeader('Last-Modified', stat.mtime.toUTCString());
    this.res.setHeader('Accept-Ranges', 'bytes');
    this.res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    this.res.status(200).end();
  }


  @post('/budget-versions/upload')
  @response(200, {description: 'Upload a new budget version'})
  async upload(
    @requestBody({
      description: 'multipart/form-data with file and changes',
      required: true,
      content: {'multipart/form-data': {'x-parser': 'stream'}},
    })
    req: Request,
  ): Promise<object> {
    const upload = multer({
      storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
        filename: (_req, file, cb) => {
          const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
          cb(null, `${ts}-${file.originalname.replace(/\s+/g, '_')}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          cb(new Error('Only PDF allowed'));
          return;
        }
        cb(null, true);
      },
      limits: {fileSize: 20 * 1024 * 1024},
    }).single('file');

    // eslint rule: avoid returning a Promise from multer callback; do all async work with .then and resolve()
    const result: object = await new Promise<object>((resolve) => {
      upload(req, this.res, (err?: unknown) => {
        if (err) {
          this.res.status(400);
          resolve({message: (err as Error).message || 'Upload failed'});
          return;
        }

        const mReq = req as UploadRequest;
        const body = mReq.body ?? {};
        const file = mReq.file;

        if (!file) {
          this.res.status(400);
          resolve({message: 'File is required'});
          return;
        }

        const relPath = path.relative(path.resolve(process.cwd(), '..'), file.path);
        this.bvRepo.create({
          uploadedAt: new Date().toISOString(),
          fileUrl: `/${relPath.replace(/\\/g, '/')}`,
          fileName: file.originalname,
          changes: body.changes ?? '',
        })
        .then((doc) => {
          resolve({ok: true, item: doc});
        })
        .catch((e: unknown) => {
          this.res.status(500);
          resolve({message: (e as Error).message || 'Save failed'});
        });
      });
    });

    return result;
  }

  @patch('/budget-versions/{id}')
  @response(200, {description: 'Update metadata (changes)'})
  async update(
    @param.path.string('id') id: string,
    @requestBody({content: {'application/json': {schema: {type: 'object', properties: {changes: {type: 'string'}}}}}})
    body: {changes?: string},
  ): Promise<object> {
    await this.bvRepo.updateById(id, {changes: body.changes ?? ''});
    return {ok: true};
  }

  @del('/budget-versions/{id}')
  @response(200, {description: 'Delete a version and file'})
  async remove(@param.path.string('id') id: string): Promise<object> {
    const rec = await this.bvRepo.findById(id).catch(() => null);
    if (rec?.fileUrl?.startsWith('/')) {
      const urlPath = (rec.fileUrl || '').replace(/^[/\\]+/, '');
      const parent = path.resolve(process.cwd(), '..');
      const filePath = path.join(parent, urlPath);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore unlink errors */ }
      }
    }
    await this.bvRepo.deleteById(id);
    return {ok: true};
  }
}
