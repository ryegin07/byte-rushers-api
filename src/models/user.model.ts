import {Entity, model, property} from '@loopback/repository';

@model({name: 'users'})
export class User extends Entity {
  @property({ type: 'string', id: true, generated: true })
  id?: string;

  @property({ type: 'string', required: true, jsonSchema: { format: 'email' } })
  email: string;

  @property({ type: 'string', jsonSchema: {nullable: true} })
  staffId?: string;

  @property({ type: 'string', required: true })
  password: string;

  @property({ type: 'string', jsonSchema: { enum: ['resident','staff'] } })
  type?: 'resident' | 'staff';

  @property({ type: 'string' })
  firstName?: string;

  @property({ type: 'string' })
  lastName?: string;

  @property({ type: 'string' })
  middleName?: string;

  @property({ type: 'string' })
  phone?: string;

  @property({ type: 'string' })
  birthDate?: string;

  @property({ type: 'string' })
  gender?: string;

  @property({ type: 'string' })
  civilStatus?: string;

  @property({ type: 'string' })
  houseNumber?: string;

  @property({ type: 'string' })
  street?: string;

  @property({ type: 'string' })
  purok?: string;

  @property({ type: 'string' })
  barangayHall?: string;

  @property({ type: 'string', jsonSchema: {nullable: true} })
  pictureUrl?: string;

  @property({ type: 'string', jsonSchema: {nullable: true} })
  resetCode?: string;

  @property({ type: 'string', jsonSchema: {format: 'date-time', nullable: true} })
  resetCodeExpiresAt?: string;

  @property({type: 'date', default: () => new Date()})
  createdAt?: string;

  @property({type: 'boolean', default: false})
  emailVerified?: boolean;

  @property({type: 'boolean', default: true})
  enableSMSNotif?: boolean;

  @property({type: 'boolean', default: true})
  enableEmailNotif?: boolean;

  @property({type: 'string'})
  verificationToken?: string;

  @property({type: 'date'})
  verificationExpires?: string;

  
@property({type: 'string'})
name?: string;

@property({type: 'string'})
occupation?: string;

@property({type: 'string'})
address?: string;

@property({type: 'string'})
emergencyContact?: string;

@property({type: 'string'})
emergencyPhone?: string;

@property({type: 'string'})
avatar?: string;

@property({type: 'string'})
hall?: string;

@property({type: 'string'})
residentId?: string;

@property({type: 'date'})
registrationDate?: string;

@property({type: 'string'})
fullName?: string;

  constructor(data?: Partial<User>) { super(data); }
}

export type UserWithRelations = User;
