import {inject} from '@loopback/core';
import {DefaultCrudRepository, juggler} from '@loopback/repository';
import {Feedback, FeedbackRelations} from '../models';

export class FeedbackRepository extends DefaultCrudRepository<
  Feedback,
  typeof Feedback.prototype.id,
  FeedbackRelations
> {
  constructor(
    @inject('datasources.mongodb') dataSource: juggler.DataSource,
  ) {
    super(Feedback, dataSource);
  }
}
