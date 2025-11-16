import {get, param, HttpErrors} from '@loopback/rest';
import {repository} from '@loopback/repository';
import {UserRepository} from '../repositories/user.repository';
import {SubmissionRepository} from '../repositories/submission.repository';
import {Submission} from '../models';

type ResidentDash = {
  totalRequests: number;
  pending: number;
  completed: number;
  activeIssues: number;
  issuesResolved: number;
  communityEngagement: number; // percentage 0-100
};

export class StatsController {
  constructor(
    @repository(UserRepository) private userRepo: UserRepository,
    @repository(SubmissionRepository) private submissionRepo: SubmissionRepository,
  ) {}

  @get('/stats/dashboard')
  async dashboard() {
    const residents = await this.userRepo.count({type: 'resident'}).then(r => r.count).catch(()=>0);
    const staff = await this.userRepo.count({type: 'staff'}).then(r => r.count).catch(()=>0);
    const documents = await this.submissionRepo.count({submissionType: 'Document', status: 'completed'} as any).then(r => r.count).catch(()=>0);
    const resolved = await this.submissionRepo.count({status: 'resolved'} as any).then(r => r.count).catch(()=>0);
    return { ok: true, residents, documents, resolved, staff };
  }

  /**
   * Resident-specific dashboard numbers.
   * Filtered by the logged-in user's email.
   * You can pass the email as a query param (e.g., /stats/dashboard/resident?email=a@b.com).
   * If your auth layer decorates the request with a user, you could adapt this to read from ctx.
   */
  @get('/stats/dashboard/resident')
  async residentDashboard(
    @param.query.string('email') email?: string,
  ): Promise<ResidentDash> {
    const userEmail = (email || '').trim().toLowerCase();
    if (!userEmail) {
      throw new HttpErrors.BadRequest('email query parameter is required');
    }

    // Load all submissions for this user once; compute stats in memory for robust case-insensitive checks.
    const fields = ['id','email','submissionType','status','createdAt','complaintId','documentReqId'] as any;
    const mine = await this.submissionRepo.find({where: {email: userEmail} as any, fields}).catch(() => [] as any[]);

    const norm = (v?: string) => (v || '').toString().trim().toLowerCase();
    const isDoc = (t?: string) => norm(t) === 'document';
    const isComplaintOrInquiry = (t?: string) => {
      const tt = norm(t);
      return tt === 'complaint' || tt === 'inquiry';
    };

    const totalRequests = mine.length;

    const pending = mine.filter(s => isDoc(s.submissionType) && (norm(s.status) === 'pending' || norm(s.status) === 'ready')).length;
    const completed = mine.filter(s => isDoc(s.submissionType) && norm(s.status) === 'completed').length;

    const activeIssues = mine.filter(s => isComplaintOrInquiry(s.submissionType) && norm(s.status) === 'active').length;
    const issuesResolved = mine.filter(s => isComplaintOrInquiry(s.submissionType) && norm(s.status) === 'resolved').length;

    const communityEngagement = totalRequests > 0
      ? Math.round(((completed + issuesResolved) / totalRequests) * 100)
      : 0;

    return { totalRequests, pending, completed, activeIssues, issuesResolved, communityEngagement };
  }

  @get('/stats/dashboard/staff', {
    responses: {
      '200': {
        description: 'Staff dashboard stats',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                totalResidents: {type: 'number'},
                pending: {type: 'number'},
                completedToday: {type: 'number'},
                activeIssue: {type: 'number'},
                documents: {type: 'number'}
              }
            }
          }
        }
      }
    }
  })
  async staffDashboard() {
    // Count total registered residents (has residentId)
    const residentsCount = await this.userRepo.count({residentId: {neq: null}} as any);
    const totalResidents = residentsCount.count;

    // Get all submissions
    const all: Submission[] = await this.submissionRepo.find();

    const norm = (v?: string) => String(v ?? '').trim().toLowerCase();
    const isDoc = (t?: string) => norm(t) === 'document';
    const isComplaintOrInquiry = (t?: string) => {
      const tt = norm(t);
      return tt === 'complaint' || tt === 'inquiry';
    };

    // Today (Asia/Manila) YYYY-MM-DD
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const manilaNow = new Date(new Date().toLocaleString('en-US', {timeZone: 'Asia/Manila'}));
    const todayStr = fmt.format(manilaNow);
    const dateKey = (iso?: string) => (iso ? fmt.format(new Date(iso)) : '');

    const pending = all.filter((s: Submission) =>
      isDoc(s.submissionType) && (norm(s.status) === 'pending' || norm(s.status) === 'verification')
    ).length;

    const documents = all.filter((s: Submission) =>
      isDoc(s.submissionType) && norm(s.status) === 'completed'
    ).length;

    const completedToday = all.filter((s: Submission) =>
      isDoc(s.submissionType) && norm(s.status) === 'completed' && dateKey(s.dateCompleted) === todayStr
    ).length;

    const activeIssue = all.filter((s: Submission) =>
      isComplaintOrInquiry(s.submissionType) && norm(s.status) === 'active'
    ).length;

    return { totalResidents, pending, completedToday, activeIssue, documents };
  }

  @get('/stats/submissions-overview', {
    responses: {
      '200': {
        description: 'Submissions overview for documents and complaints',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                oldestDate: {type: 'string', nullable: true},
                from: {type: 'string'},
                to: {type: 'string'},
                document: {
                  type: 'object',
                  properties: {
                    inProgress: {type: 'number'},
                    completed: {type: 'number'},
                  },
                },
                complaint: {
                  type: 'object',
                  properties: {
                    inProgress: {type: 'number'},
                    completed: {type: 'number'},
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async submissionsOverview(
    @param.query.string('from') fromQ?: string,
    @param.query.string('to') toQ?: string,
  ): Promise<{
    oldestDate: string | null;
    from: string;
    to: string;
    document: {inProgress: number; completed: number};
    complaint: {inProgress: number; completed: number};
  }> {
    const parseDate = (v?: string): Date | undefined => {
      if (!v) return undefined;
      const d = new Date(v);
      return isNaN(d.getTime()) ? undefined : d;
    };

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setHours(0, 0, 0, 0);
    const defaultTo = new Date(now);
    defaultTo.setHours(23, 59, 59, 999);

    const from = parseDate(fromQ) || defaultFrom;
    const to = parseDate(toQ) || defaultTo;

    // Load all submissions once, then classify by created vs completed within range
    const fields = ['id', 'submissionType', 'status', 'createdAt', 'dateCompleted'] as any;
    const all = await this.submissionRepo
      .find({fields})
      .catch(() => [] as Submission[]);

    const norm = (v?: string) => (v || '').toString().trim().toLowerCase();
    const isDoc = (t?: string) => norm(t) === 'document';
    const isComplaint = (t?: string) => norm(t) === 'complaint';

    const inRange = (value?: string | Date) => {
      if (!value) return false;
      const d = typeof value === 'string' ? new Date(value) : value;
      if (isNaN(d.getTime())) return false;
      return d >= from && d <= to;
    };

    let docCreated = 0;
    let docCompleted = 0;
    let complaintCreated = 0;
    let complaintCompleted = 0;

    for (const s of all as any[]) {
      const status = norm(s.status);
      const createdAt = s.createdAt;
      const completedAt = s.dateCompleted;

      if (isDoc(s.submissionType)) {
        if (inRange(createdAt)) {
          docCreated++;
        }
        if (status === 'completed' && inRange(completedAt)) {
          docCompleted++;
        }
      } else if (isComplaint(s.submissionType)) {
        if (inRange(createdAt)) {
          complaintCreated++;
        }
        if (status === 'resolved' && inRange(completedAt)) {
          complaintCompleted++;
        }
      }
    }

    const oldestArr = await this.submissionRepo
      .find({
        order: ['createdAt ASC'],
        limit: 1,
        fields: ['createdAt'] as any,
      })
      .catch(() => [] as Submission[]);
      
    const oldestRaw = oldestArr[0] as any;
    const oldest =
      oldestRaw && oldestRaw.createdAt
        ? new Date(oldestRaw.createdAt)
        : undefined;

    return {
      oldestDate: oldest ? oldest.toISOString() : null,
      from: from.toISOString(),
      to: to.toISOString(),
      document: {
        inProgress: docCreated,
        completed: docCompleted,
      },
      complaint: {
        inProgress: complaintCreated,
        completed: complaintCompleted,
      },
    };
  }

}

