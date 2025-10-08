import {Entity, model, property} from '@loopback/repository';

@model({settings: {strict: true}})
export class Feedback extends Entity {
  @property({type: 'string', id: true, generated: true})
  id?: string;

  @property({type: 'string', required: false})
  userId?: string;

  @property({type: 'string', required: true})
  page: string;

  @property({type: 'number', required: true, jsonSchema: {minimum: 1, maximum: 5}})
  rating: number;

  @property({type: 'string'})
  comment?: string;

  @property({type: 'date', defaultFn: 'now'})
  createdAt?: string;

  constructor(data?: Partial<Feedback>) {
    super(data);
  }
}

export interface FeedbackRelations {
  // describe navigational properties here
}

export type FeedbackWithRelations = Feedback & FeedbackRelations;
