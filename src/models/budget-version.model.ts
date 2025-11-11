import {Entity, model, property} from '@loopback/repository';

@model({settings: {strict: true}})
export class BudgetVersion extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
  })
  id?: string;

  @property({
    type: 'date',
    required: true,
    defaultFn: 'now',
  })
  uploadedAt: string;

  @property({
    type: 'string',
    required: true,
  })
  fileUrl: string;

  @property({
    type: 'string',
  })
  fileName?: string;

  @property({
    type: 'string',
  })
  changes?: string;

  constructor(data?: Partial<BudgetVersion>) {
    super(data);
  }
}

export type BudgetVersionRelations = {};
export type BudgetVersionWithRelations = BudgetVersion & BudgetVersionRelations;