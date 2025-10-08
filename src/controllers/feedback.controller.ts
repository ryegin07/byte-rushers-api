import {repository} from '@loopback/repository';
import {post, requestBody, get, param} from '@loopback/rest';
import {Feedback} from '../models';
import {FeedbackRepository} from '../repositories';

export class FeedbackController {
  constructor(
    @repository(FeedbackRepository) public feedbackRepo: FeedbackRepository,
  ) {}

  @post('/feedback', {
    responses: {
      '200': {
        description: 'Feedback model instance',
        content: {'application/json': {schema: {'x-ts-type': Feedback}}},
      },
    },
  })
  async create(
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['page', 'rating'],
            properties: {
              page: {type: 'string'},
              rating: {type: 'number', minimum: 1, maximum: 5},
              comment: {type: 'string'},
              userId: {type: 'string'},
            },
          },
        },
      },
    })
    body: Omit<Feedback, 'id' | 'createdAt'>,
  ): Promise<Feedback> {
    return this.feedbackRepo.create(body as any);
  }

  @get('/feedback', {
    responses: {
      '200': {
        description: 'List feedback (optional by page)',
        content: {'application/json': {schema: {type: 'array', items: {'x-ts-type': Feedback}}}},
      },
    },
  })
  async list(
    @param.query.string('page') page?: string,
  ): Promise<Feedback[]> {
    const where = page ? {page} : {};
    return this.feedbackRepo.find({where, order: ['createdAt DESC']});
  }
}
