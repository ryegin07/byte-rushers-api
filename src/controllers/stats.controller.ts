import {get} from '@loopback/rest';
import {repository} from '@loopback/repository';
import {UserRepository} from '../repositories/user.repository';
import {SubmissionRepository} from '../repositories/submission.repository';

export class StatsController {
  constructor(
    @repository(UserRepository) private userRepo: UserRepository,
    @repository(SubmissionRepository) private submissionRepo: SubmissionRepository,
  ) {}

  @get('/stats/dashboard')
  async dashboard() {
    const residents = await this.userRepo.count({type: 'resident'}).then(r => r.count).catch(()=>0);
    const staff = await this.userRepo.count({type: 'staff'}).then(r => r.count).catch(()=>0);
    const documents = await this.submissionRepo.count({submissionType: 'Document'}).then(r => r.count).catch(()=>0);
    const resolved = await this.submissionRepo.count({status: {inq: ['completed','resolved','done','closed']}} as any).then(r => r.count).catch(()=>0);
    return { ok: true, residents, documents, resolved, staff };
  }
}
