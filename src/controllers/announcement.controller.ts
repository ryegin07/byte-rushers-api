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
import {AnnouncementRepository} from '../repositories';

function normalizeForScheduling(input: Partial<Announcement>): Partial<Announcement> {
  const out: Partial<Announcement> = {...input};

  // Normalize schedule string (only accept non-empty string)
  const hasSchedule = typeof out.publishedSchedule === 'string' && out.publishedSchedule.trim().length > 0;

  if (hasSchedule) {
    // RULE: any item with a schedule is NOT published (to be handled by a scheduler later)
    out.published = false;
    out.publishedSchedule = new Date(out.publishedSchedule!).toISOString();
  } else if (out.published === true) {
    // Publish now ⇒ clear schedule entirely (do not store null)
    out.published = true;
    delete out.publishedSchedule;
  } else {
    // Draft (unscheduled) ⇒ published=false and no schedule field
    out.published = false;
    delete out.publishedSchedule;
  }

  // Optional: keep `draft` consistent (derived)
  // draft = !published
  out.draft = out.published === true ? false : true;

  return out;
}

export class AnnouncementController {
  constructor(
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
    const normalized = normalizeForScheduling(body);

    const nowIso = new Date().toISOString() as any;
    normalized.createdAt = nowIso;
    normalized.updatedAt = nowIso;

    return this.announcementRepository.create(normalized as Announcement);
  }

  @get('/announcements/{id}')
  @response(200, {
    description: 'Get announcement by id',
    content: {'application/json': {schema: getModelSchemaRef(Announcement)}},
  })
  async findById(@param.path.string('id') id: string): Promise<Announcement> {
    return this.announcementRepository.findById(id);
  }

  // Drafts = anything not published (includes scheduled ones, per your rule)
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
      where: {published: {neq: true}},
      order: ['updatedAt DESC'],
    });
  }

  // NEW: scheduled list (handy for your future scheduler)
  // Items that are not published and have a publish date
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
      where: {
        and: [
          {published: false},
          {publishedSchedule: {neq: undefined}}, // any non-empty schedule (we never store null)
        ],
      },
      order: ['publishedSchedule ASC'],
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
    const updates = normalizeForScheduling(body);
    updates.updatedAt = new Date().toISOString() as any;

    await this.announcementRepository.updateById(id, updates);
    return this.announcementRepository.findById(id);
  }
}
