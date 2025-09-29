import {Entity, model, property} from '@loopback/repository';

@model({name: 'users'})
export class User extends Entity {
  @property({ type: 'string', id: true, generated: true })
  id?: string;

  @property({ type: 'string', required: true, jsonSchema: { format: 'email' } })
  email: string;

  @property({ type: 'string', required: true })
  password: string;

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
  resetCode?: string;

  @property({ type: 'string', jsonSchema: {format: 'date-time', nullable: true} })
  resetCodeExpiresAt?: string;
  constructor(data?: Partial<User>) { super(data); }
  
  @property({ type: 'string' })
  userType?: string;
}

export type UserWithRelations = User;
