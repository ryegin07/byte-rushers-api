import {get, param} from '@loopback/rest';
import {repository, Filter, Where, AnyObject} from '@loopback/repository';
import {UserRepository} from '../repositories';
import {User} from '../models';

type LookupResult = {
  residentId?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  birthDate?: string | Date;
  houseNumber?: string;
  street?: string;
  purok?: string;
  barangayHall?: string;
  civilStatus?: string;
  occupation?: string;
  contactName?: string;
  contactPhone?: string;
  registrationDate?: string | Date;
  email?: string;
  emailVerified?: boolean;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ciRegExp = (v: string) => ({regexp: new RegExp(escapeRegExp(v), 'i')});
const likeWrap = (v: string) => ({like: `%${v}%`});

const norm = (v?: string) => (v ?? '').trim().toLowerCase();
const isExact = (a?: string, b?: string) => norm(a) === norm(b);
const tokenMatch = (hay?: string, needle?: string) => {
  if (!needle) return true;
  if (!hay) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(needle)}(\\s|$)`, 'i').test(hay);
};

function parseDate(val?: string | Date): number {
  if (!val) return 0;
  const d = new Date(val);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

export class ResidentLookupController {
  constructor(
    @repository(UserRepository)
    public userRepository: UserRepository,
  ) {}

  @get('/residents/lookup', {
    responses: {
      '200': {
        description: 'Resident lookup results',
        content: {'application/json': {schema: {type: 'array', items: {type: 'object'}}}},
      },
    },
  })
  async lookup(
    @param.query.string('firstName') firstName?: string,
    @param.query.string('lastName') lastName?: string,
    @param.query.string('purok') purok?: string,
    @param.query.string('barangayHall') barangayHall?: string,
    @param.query.string('email') email?: string,
    @param.query.string('residentId') residentId?: string,
  ): Promise<LookupResult[]> {
    const TYPE_COND = {type: 'resident'} as AnyObject;
    // Build CI where with regexp; fallback to LIKE if needed.
    const andCI: AnyObject[] = [TYPE_COND];
    if (residentId) andCI.push({residentId: ciRegExp(residentId)});
    if (email) andCI.push({email: ciRegExp(email)});
    if (firstName) andCI.push({firstName: ciRegExp(firstName)});
    if (lastName) andCI.push({lastName: ciRegExp(lastName)});
    if (purok) andCI.push({purok: ciRegExp(purok)});
    if (barangayHall) andCI.push({barangayHall: ciRegExp(barangayHall)});

    const whereCI: Where<User> = andCI.length ? ({and: andCI} as unknown as Where<User>) : {};
    const baseFilter: Omit<Filter<User>, 'where'> = {order: ['lastName ASC', 'firstName ASC'], limit: 500};

    let rows = [] as (Partial<User> & AnyObject)[];
    try {
      rows = (await this.userRepository.find({where: whereCI, ...baseFilter})) as any[];
    } catch {
      const andLIKE: AnyObject[] = [TYPE_COND];
      if (residentId) andLIKE.push({residentId: likeWrap(residentId)});
      if (email) andLIKE.push({email: likeWrap(email)});
      if (firstName) andLIKE.push({firstName: likeWrap(firstName)});
      if (lastName) andLIKE.push({lastName: likeWrap(lastName)});
      if (purok) andLIKE.push({purok: likeWrap(purok)});
      if (barangayHall) andLIKE.push({barangayHall: likeWrap(barangayHall)});
      const whereLIKE: Where<User> = andLIKE.length ? ({and: andLIKE} as unknown as Where<User>) : {};
      rows = (await this.userRepository.find({where: whereLIKE, ...baseFilter})) as any[];
    }

    // 1) De-duplicate by a stable key (residentId → email → internal id)
    const seen = new Map<string, (Partial<User> & AnyObject)>();
    for (const r of rows) {
      const key = String(r.residentId ?? r.email ?? r.id ?? JSON.stringify(r));
      if (!seen.has(key)) seen.set(key, r);
    }
    let uniqueRows = Array.from(seen.values());

    // 2) If user searched by name, collapse to the best record per "full name" group.
    if (firstName || lastName) {
      const groups = new Map<string, (Partial<User> & AnyObject)[]>();
      for (const r of uniqueRows) {
        const fn = norm(r.firstName as string);
        const ln = norm(r.lastName as string);
        const key = `${fn}|${ln}`; // group by CI first+last
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
      }

      const scored: (Partial<User> & AnyObject)[] = [];
      const qFN = firstName ?? '';
      const qLN = lastName ?? '';

      for (const [, arr] of groups) {
        if (arr.length === 1) {
          scored.push(arr[0]);
          continue;
        }
        // score and pick best
        let best = arr[0];
        let bestScore = -Infinity;
        for (const r of arr) {
          let s = 0;
          const rFN = r.firstName as string | undefined;
          const rLN = r.lastName as string | undefined;

          if (firstName) {
            if (isExact(rFN, qFN)) s += 5;
            else if (tokenMatch(rFN, qFN)) s += 2;
          }
          if (lastName) {
            if (isExact(rLN, qLN)) s += 5;
            else if (tokenMatch(rLN, qLN)) s += 2;
          }

          if (r.residentId) s += 1;
          if (r.emailVerified) s += 1;

          // tie-breaker by most recent registrationDate
          const reg = parseDate(r.registrationDate as any);

          // compare
          if (s > bestScore) {
            bestScore = s;
            best = r;
          } else if (s === bestScore) {
            const bestReg = parseDate(best.registrationDate as any);
            if (reg > bestReg) best = r;
          }
        }
        scored.push(best);
      }

      uniqueRows = scored;
    }

    // stable sorting for display
    uniqueRows.sort((a, b) => {
      const la = norm(a.lastName as string);
      const lb = norm(b.lastName as string);
      if (la < lb) return -1;
      if (la > lb) return 1;
      const fa = norm(a.firstName as string);
      const fb = norm(b.firstName as string);
      if (fa < fb) return -1;
      if (fa > fb) return 1;
      return `${a.residentId ?? ''}`.localeCompare(`${b.residentId ?? ''}`);
    });

    // Map to response payload
    return uniqueRows.map((r) => ({
      residentId: r.residentId,
      firstName: r.firstName,
      middleName: r.middleName,
      lastName: r.lastName,
      birthDate: r.birthDate,
      houseNumber: r.houseNumber,
      street: r.street,
      purok: r.purok,
      barangayHall: r.barangayHall,
      civilStatus: r.civilStatus,
      occupation: r.occupation,
      contactName: r.emergencyContact,
      contactPhone: r.emergencyPhone,
      registrationDate: r.registrationDate,
      email: r.email,
      emailVerified: !!r.emailVerified,
    }));
  }
}
