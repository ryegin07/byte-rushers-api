
import {Entity, model, property} from '@loopback/repository';

@model({settings: {strict: true}})
export class Submission extends Entity {
  @property({type: 'string', id: true, generated: true})
  id?: string;

  // Common submitter info
  @property({type: 'string', required: true})
  name: string;

  @property({type: 'string'})
  email?: string;

  @property({type: 'string'})
  phone?: string;

  @property({type: 'string'})
  address?: string;

  // Generic fields used across forms
  @property({type: 'string'})
  type?: string;

  @property({type: 'string'})
  priority?: string;

  @property({type: 'string'})
  location?: string;

  @property({type: 'string'})
  hall?: string;

  @property({type: 'string'})
  subject?: string;

  @property({type: 'string'})
  message?: string;

  @property({type: 'string'})
  category?: string;

  @property({type: 'boolean'})
  urgent?: boolean;

  @property({type: 'boolean'})
  anonymous?: boolean;

  @property({type: 'boolean'})
  smsNotifications?: boolean;

  @property({type: 'string'})
  evidenceUrl?: string;

  @property({type: 'string'})
  fileUrl?: string;

  // Classification
  @property({
    type: 'string',
    jsonSchema: { enum: ['Complaint','Inquiry','Document'] },
  })
  submissionType?: string;

  @property({
    type: 'string',
    jsonSchema: { enum: ['pending','ready','completed','active','resolved', 'cancelled'] },
  })
  status?: string;

  // Complaint-specific
  @property({type: 'string'})
  complaintId?: string;

  // Document-specific
  @property({type: 'string'})
  documentReqId?: string;

  @property({type: 'string'})
  requestorName?: string;

  @property({type: 'string'})
  documentType?: string;

  @property({type: 'string'})
  purpose?: string;

  @property({type: 'string'})
  pickupHall?: string;

  @property({type: 'boolean'})
  urgentRequest?: boolean;

  @property({type: 'string'})
  additionalNotes?: string;

  @property({type: 'date', jsonSchema: {nullable: true}})
  dateCompleted?: string;
  
  @property({type: 'number', jsonSchema: {minimum: 0}})
  fee?: number;

  @property({type: 'date', defaultFn: 'now'})
  createdAt?: string;

  constructor(data?: Partial<Submission>) {
    super(data);
  }
}

export interface SubmissionRelations {
  // describe navigational properties here
}

export type SubmissionWithRelations = Submission & SubmissionRelations;