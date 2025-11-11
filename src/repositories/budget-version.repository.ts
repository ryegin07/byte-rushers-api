import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {MongodbDataSource} from '../datasources';
import {BudgetVersion, BudgetVersionRelations} from '../models';

export class BudgetVersionRepository extends DefaultCrudRepository<
  BudgetVersion,
  typeof BudgetVersion.prototype.id,
  BudgetVersionRelations
> {
  constructor(
    @inject('datasources.mongodb') dataSource: MongodbDataSource,
  ) {
    super(BudgetVersion, dataSource);
  }
}