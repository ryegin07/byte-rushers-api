/* eslint-disable @typescript-eslint/naming-convention */
import {get, response} from '@loopback/rest';
import {repository} from '@loopback/repository';

import {SubmissionRepository} from '../repositories/submission.repository';
import {UserRepository} from '../repositories/user.repository';

/** ---------- Small utility parsing functions (no implicit any) ---------- */
const asNum = (v: unknown, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const asStr = (v: unknown, def = ''): string => {
  const s = String(v ?? def);
  return s;
};
const asArr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** ---------- Mongo shapes ---------- */
interface SummaryDoc {
  date_generated?: Date | string;
  system_efficiency?: unknown;
  ai_recommendations?: unknown;
}
interface HotspotDoc {
  hall?: unknown;
  risk_score?: unknown;
  predicted_count?: unknown;
  common_issues?: unknown;
  recommended_actions?: unknown;
}
interface ForecastPoint {
  date?: unknown;
  yhat?: unknown;
  yhat_lower?: unknown;
  yhat_upper?: unknown;
}
interface ServiceForecastDoc {
  service?: unknown;
  used_model?: unknown;
  forecast?: unknown;
  date_generated?: unknown;
}
interface AllocationDoc {
  hall?: unknown;
  service?: unknown;
  predicted_demand?: unknown;
  predictedDemand?: unknown;
  recommended_staff?: unknown;
  recommendedStaff?: unknown;
  efficiency?: unknown;
  bottlenecks?: unknown;
}
interface EmergencyDoc {
  hall?: unknown;
  class?: unknown;
  probability?: unknown;
  estimated_response_time_min?: unknown;
  required_resources?: unknown;
  preventive_measures?: unknown;
}

/** ---------- DTOs for the Web UI ---------- */
interface HotspotCard {
  location: string;
  riskScore: number;
  predictedComplaints: number;
  commonIssues: string[];
  recommendedActions: string[];
  peakHours: string[];
  priorityServices: string[];
}
interface ServiceDemandCard {
  service: string;
  currentDemand: number;
  predictedDemand: number;
  recommendedStaff: number;
  confidence: number;
  peakHours: string[];
}
interface HallAllocationCard {
  hall: string;
  currentLoad: number;
  predictedLoad: number;
  recommendedStaff: number;
  efficiency: number;
  priorityServices: string[];
}
interface EmergencyCard {
  type: string;
  location: string;
  probability: number; // percent 0–100
  estimatedResponseTime: number;
  requiredResources: string[];
  preventiveMeasures: string[];
  peakHours: string[];
  priorityServices: string[];
}

type ServiceKey = 'Complaint' | 'Document';

export class AnalyticsController {
  constructor(
    @repository(SubmissionRepository) private submissionRepo: SubmissionRepository,
    @repository(UserRepository) private userRepo: UserRepository,
  ) {}

  // ---------- Config / constants ----------
  private readonly AHT_COMPLAINT = asNum(process.env.AHT_COMPLAINT, 60); // minutes
  private readonly AHT_DOCUMENT = asNum(process.env.AHT_DOCUMENT, 20);   // minutes
  private readonly SLA_DAYS = asNum(process.env.SLA_DAYS, 4);
  private readonly STAFF_DAY_CAPACITY_MIN = 7 * 60; // 7h/day per staff
  private readonly DEBUG_VARIANCE = Boolean(process.env.ANALYTICS_DEBUG_VARIANCE);

  private readonly SERVICES: ServiceKey[] = ['Complaint', 'Document'];

  /** Decide suffix for prediction collection names */
  private suffix(): string {
    const explicit = process.env.PREDICTIONS_SUFFIX ?? '';
    if (explicit) return explicit;
    return process.env.ANALYTICS_SOURCE === 'real' ? '' : '_synth';
  }

  /** Access the LoopBack Mongo connector via repository (no mongodb typings needed) */
  private mongoConnector(): {collection?: (name: string) => any; db?: {collection: (name: string) => any}} {
    const ds: unknown = (this.submissionRepo as unknown as {dataSource?: unknown}).dataSource;
    const conn = (ds as {connector?: unknown})?.connector as {collection?: (name: string) => any; db?: {collection: (name: string) => any}} | undefined;
    if (!conn) throw new Error('Mongo connector not available via repository.dataSource');
    return conn;
  }

  /** Get a native collection via connector.collection(name) (or connector.db.collection) */
  private collection(name: string): any {
    const conn = this.mongoConnector();
    if (typeof conn.collection === 'function') return conn.collection(name);
    if (conn?.db?.collection) return conn.db.collection(name);
    throw new Error('Mongo collection accessor not found on connector');
  }

  private async readPredictionsFromDb() {
    const sfx = this.suffix();

    const summary = (await this.collection(`predictions_summary${sfx}`)
      .find({})
      .sort({date_generated: -1})
      .limit(1)
      .next()) as SummaryDoc | null;

    const hotspots = (await this.collection(`predictions_hotspot${sfx}`)
      .find({})
      .sort({date_generated: -1, risk_score: -1})
      .toArray()) as HotspotDoc[];

    const serviceForecast = (await this.collection(`predictions_service_forecast${sfx}`)
      .find({})
      .sort({date_generated: -1})
      .toArray()) as ServiceForecastDoc[];

    const allocation = (await this.collection(`predictions_allocation${sfx}`)
      .find({})
      .sort({date_generated: -1})
      .toArray()) as AllocationDoc[];

    const emergency = (await this.collection(`predictions_emergency${sfx}`)
      .find({})
      .sort({date_generated: -1})
      .toArray()) as EmergencyDoc[];

    return {summary, hotspots, serviceForecast, allocation, emergency};
  }

  // ---------- Date helpers (UTC) ----------
  private startOfDayUTC(d: Date) {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  }
  private endOfDayUTC(d: Date) {
    const x = new Date(d);
    x.setUTCHours(23, 59, 59, 999);
    return x;
  }
  private fmtHourRange(h: number) {
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const from = `${pad(h)}:00`;
    const to = `${pad((h + 1) % 24)}:00`;
    return `${from}–${to}`;
  }

  // ---------- Simple dedup + cap for recommendations ----------
  private dedupCap(recs: string[], cap = 8): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of recs) {
      const key = r.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= cap) break;
    }
    return out;
  }

  // ===================== /analytics/ml-insights =====================
  @get('/analytics/ml-insights')
  @response(200, {description: 'ML Insights'})
  async mlInsights() {
    const EMPTY: unknown[] = [];

    let overallEfficiency = 75;
    let recommendations: string[] = [];
    let hotspotsOut: HotspotCard[] = [];
    let serviceDemand: ServiceDemandCard[] = [];
    let resourceAllocation: HallAllocationCard[] = [];
    let emergencyPredictions: EmergencyCard[] = [];
    let lastUpdated: string | undefined;
    let topLevelPriorityServices: string[] = [];

    const AHT: Record<ServiceKey, number> = {
      Complaint: this.AHT_COMPLAINT,
      Document: this.AHT_DOCUMENT,
    };

    try {
      const {summary, hotspots, serviceForecast, allocation, emergency} =
        await this.readPredictionsFromDb();

      if (summary) {
        overallEfficiency = asNum(summary.system_efficiency, 75);
        recommendations = asArr<string>(summary.ai_recommendations);
        lastUpdated = asStr(summary.date_generated ?? '', '');
      }

      // ---------- HOTSPOTS ----------
      hotspotsOut = hotspots.map<HotspotCard>((h) => {
        const issues = asArr<string>(h.common_issues);
        return {
          location: asStr(h.hall, ''),
          riskScore: asNum(h.risk_score, 0),
          predictedComplaints: asNum(h.predicted_count, 0),
          commonIssues: issues,
          recommendedActions: asArr<string>(h.recommended_actions),
          peakHours: [],
          priorityServices: issues.slice(0, 3),
        };
      });

      // ---------- Build “current” signals from submissions ----------
      const now = new Date();
      const todayStart = this.startOfDayUTC(now);
      const todayEnd = this.endOfDayUTC(now);
      const yest = new Date(now.getTime() - 24 * 3600 * 1000);
      const yStart = this.startOfDayUTC(yest);
      const yEnd = this.endOfDayUTC(yest);

      // Yesterday per-service counts → currentDemand
      const yestAgg = (await this.collection('submissions').aggregate([
        {$match: {createdAt: {$gte: yStart, $lte: yEnd}, submissionType: {$in: this.SERVICES}}},
        {$group: {_id: '$submissionType', count: {$sum: 1}}},
      ]).toArray()) as Array<{_id?: unknown; count?: unknown}>;

      const yestCountsByService: Record<ServiceKey, number> = {Complaint: 0, Document: 0};
      for (const r of yestAgg) {
        const key = asStr(r._id, '') as ServiceKey;
        if ((this.SERVICES as string[]).includes(key)) {
          yestCountsByService[key] = asNum(r.count, 0);
        }
      }

      // Yesterday per-service hour buckets → peakHours
      const yestHours = (await this.collection('submissions').aggregate([
        {$match: {createdAt: {$gte: yStart, $lte: yEnd}, submissionType: {$in: this.SERVICES}}},
        {$project: {submissionType: 1, hour: {$hour: '$createdAt'}}},
        {$group: {_id: {svc: '$submissionType', hour: '$hour'}, cnt: {$sum: 1}}},
        {$sort: {'_id.svc': 1 as const, cnt: -1 as const}},
      ]).toArray()) as Array<{_id?: {svc?: unknown; hour?: unknown}; cnt?: unknown}>;

      const peakHourByService: Record<ServiceKey, string[]> = {Complaint: [], Document: []};
      for (const row of yestHours) {
        const svc = asStr(row?._id?.svc, '') as ServiceKey;
        const hour = asNum(row?._id?.hour, 9);
        const label = this.fmtHourRange(hour);
        if ((this.SERVICES as string[]).includes(svc)) {
          peakHourByService[svc].push(label);
        }
      }
      // Dedup & fallback defaults
      for (const svc of this.SERVICES) {
        const dedup = Array.from(new Set(peakHourByService[svc]));
        peakHourByService[svc] =
          dedup.slice(0, 3).length ? dedup.slice(0, 3)
          : svc === 'Document'
            ? ['09:00–10:00', '12:00–13:00', '16:00–17:00']
            : ['08:00–09:00', '14:00–15:00', '19:00–20:00'];
      }

      // Today per hall/service counts → currentLoad
      const todayAgg = (await this.collection('submissions').aggregate([
        {$match: {createdAt: {$gte: todayStart, $lte: todayEnd}, submissionType: {$in: this.SERVICES}}},
        {$group: {_id: {svc: '$submissionType', hall: '$hall'}, count: {$sum: 1}}},
      ]).toArray()) as Array<{_id?: {svc?: unknown; hall?: unknown}; count?: unknown}>;

      const todayCountsByHallSvc: Record<string, Record<ServiceKey, number>> = {};
      for (const r of todayAgg) {
        const hall = asStr(r?._id?.hall, '');
        const svc = asStr(r?._id?.svc, '') as ServiceKey;
        if (!hall || !(this.SERVICES as string[]).includes(svc)) continue;
        if (!todayCountsByHallSvc[hall]) {
          todayCountsByHallSvc[hall] = {Complaint: 0, Document: 0};
        }
        todayCountsByHallSvc[hall][svc] = asNum(r.count, 0);
      }

      // ---------- SERVICE DEMAND ----------
      serviceDemand = serviceForecast.map<ServiceDemandCard>((pack) => {
        const svc = asStr(pack.service, 'Unknown');
        const forecastArr = asArr<ForecastPoint>(pack.forecast).map(fp => ({
          date: asStr(fp.date, ''),
          yhat: asNum(fp.yhat, 0),
          yhat_lower: asNum(fp.yhat_lower, 0),
          yhat_upper: asNum(fp.yhat_upper, 0),
        }));

        const total = forecastArr.reduce<number>((acc, d) => acc + asNum(d.yhat, 0), 0);

        const widths = forecastArr.map((d) => {
          const y = asNum(d.yhat, 0);
          const u = asNum(d.yhat_upper, y);
          return y > 0 ? (u - y) / y : 0.5;
        });
        const meanWidth = widths.length
          ? widths.reduce<number>((acc, w) => acc + w, 0) / widths.length
          : 0.4;
        const confidence = clamp(Math.round(100 - 100 * meanWidth), 50, 95);

        const staffSum = allocation
          .filter((a) => asStr(a.service, '') === svc)
          .reduce<number>((acc, a) => acc + asNum(a.recommended_staff ?? a.recommendedStaff, 0), 0);

        const current =
          svc === 'Complaint' || svc === 'Document'
            ? yestCountsByService[svc]
            : 0;

        const peak =
          svc === 'Complaint' || svc === 'Document'
            ? peakHourByService[svc]
            : ['09:00–10:00'];

        return {
          service: svc,
          currentDemand: current,
          predictedDemand: Number(total.toFixed(2)),
          recommendedStaff: staffSum || 1,
          confidence,
          peakHours: peak,
        };
      });

      topLevelPriorityServices = serviceDemand
        .slice()
        .sort((a, b) => b.predictedDemand - a.predictedDemand)
        .map((s) => s.service)
        .slice(0, 3);

      // ---------- RESOURCE ALLOCATION ----------
      const byHall = new Map<string, AllocationDoc[]>();
      for (const row of allocation) {
        const hall = asStr(row.hall, '');
        if (!byHall.has(hall)) byHall.set(hall, []);
        byHall.get(hall)!.push(row);
      }

      resourceAllocation = [];
      for (const [hall, rows] of byHall.entries()) {
        let staffHall = 0;
        let effSum = 0;
        let effCnt = 0;

        const predMinutesBySvc: Record<ServiceKey, number> = {Complaint: 0, Document: 0};

        const todayCounts = todayCountsByHallSvc[hall] ?? {Complaint: 0, Document: 0};
        const currentMinutesNeeded =
          todayCounts.Complaint * AHT.Complaint +
          todayCounts.Document * AHT.Document;

        for (const r of rows) {
          const svc = asStr(r.service, '') as ServiceKey;
          const recStaffSvc = asNum(r.recommended_staff ?? r.recommendedStaff, 0);
          staffHall += recStaffSvc;

          const eff = asNum(r.efficiency, 70);
          effSum += eff;
          effCnt += 1;

          const predDemandSvc = asNum(r.predicted_demand ?? r.predictedDemand, 0);
          if (svc === 'Complaint') predMinutesBySvc.Complaint += predDemandSvc * AHT.Complaint;
          if (svc === 'Document') predMinutesBySvc.Document += predDemandSvc * AHT.Document;
        }

        const currentCapacity = Math.max(1, staffHall) * this.STAFF_DAY_CAPACITY_MIN;
        const predictedCapacity = Math.max(1, staffHall) * this.STAFF_DAY_CAPACITY_MIN * Math.max(1, this.SLA_DAYS);

        const predictedMinutesNeeded = predMinutesBySvc.Complaint + predMinutesBySvc.Document;

        const currentLoad = Math.round(100 * currentMinutesNeeded / currentCapacity);
        const predictedLoad = Math.round(100 * predictedMinutesNeeded / predictedCapacity);
        const avgEff = effCnt ? Math.round(effSum / effCnt) : 70;

        const priorityServices = (Object.entries(predMinutesBySvc) as Array<[ServiceKey, number]>)
          .sort((a, b) => b[1] - a[1])
          .map(([svc]) => svc)
          .slice(0, 2);

        resourceAllocation.push({
          hall,
          currentLoad: clamp(currentLoad, 0, 200),
          predictedLoad: clamp(predictedLoad, 0, 200),
          recommendedStaff: Math.max(1, Math.round(staffHall)),
          efficiency: clamp(avgEff, 40, 100),
          priorityServices,
        });
      }

      // ---------- EMERGENCY ----------
      emergencyPredictions = asArr<EmergencyDoc>(emergency).map<EmergencyCard>((e) => ({
        type: asStr(e.class, '').toUpperCase(),
        location: asStr(e.hall, ''),
        probability: Math.round(100 * asNum(e.probability, 0)),
        estimatedResponseTime: asNum(e.estimated_response_time_min, 0),
        requiredResources: asArr<string>(e.required_resources),
        preventiveMeasures: asArr<string>(e.preventive_measures),
        peakHours: [],
        priorityServices: [asStr(e.class, 'Unknown')],
      }));

      // ---------- Negative scenario showcase (non-persistent) ----------
      if (this.DEBUG_VARIANCE) {
        if (resourceAllocation.length) {
          const j = Math.floor(Math.random() * resourceAllocation.length);
          resourceAllocation[j].predictedLoad = clamp(resourceAllocation[j].predictedLoad + 25, 60, 140);
          resourceAllocation[j].efficiency = clamp(resourceAllocation[j].efficiency - 15, 40, 90);
          const k = (j + 1) % resourceAllocation.length;
          resourceAllocation[k].currentLoad = clamp(resourceAllocation[k].currentLoad + 20, 30, 140);
        }
        if (serviceDemand.length) {
          const idx = Math.floor(Math.random() * serviceDemand.length);
          serviceDemand[idx].recommendedStaff = Math.max(serviceDemand[idx].recommendedStaff, 3);
        }
      }

      // ---------- Build fallback AI recommendations (if summary was empty) ----------
      if (!recommendations || recommendations.length === 0) {
        const recs: string[] = [];

        // Hotspots: high risk
        for (const h of hotspotsOut.slice(0, 3)) {
          if (h.riskScore >= 75) {
            const reason = h.commonIssues[0] ? ` (${h.commonIssues[0]})` : '';
            recs.push(`Pre-position staff at ${h.location}${reason}; inspect and address known issues.`);
          } else if (h.riskScore >= 60) {
            recs.push(`Increase patrols and visibility near ${h.location}; monitor for rising complaints.`);
          }
        }

        // Services: big lift or low confidence
        for (const s of serviceDemand) {
          const lift = s.currentDemand > 0 ? (s.predictedDemand - s.currentDemand) / Math.max(1, s.currentDemand) : (s.predictedDemand > 0 ? 1 : 0);
          if (lift >= 0.5 && s.predictedDemand >= 5) {
            const peak = s.peakHours[0] ?? 'peak hours';
            recs.push(`Add ${Math.max(1, Math.round(s.recommendedStaff / 2))} temporary ${s.service.toLowerCase()} clerk(s) during ${peak}.`);
          }
          if (s.confidence <= 60 && s.predictedDemand >= 3) {
            recs.push(`Monitor ${s.service.toLowerCase()} volume closely this week (low model confidence).`);
          }
        }

        // Allocation: stressed halls
        for (const hall of resourceAllocation) {
          if (hall.predictedLoad >= 85) {
            recs.push(`Increase staffing at ${hall.hall} by +1 to offset projected ${hall.predictedLoad}% load.`);
          } else if (hall.efficiency <= 55) {
            recs.push(`Review process bottlenecks at ${hall.hall}; efficiency at ${hall.efficiency}%.`);
          } else if (hall.currentLoad <= 25 && hall.efficiency >= 85) {
            recs.push(`Consider reallocating 1 staff from ${hall.hall} during off-peak hours.`);
          }
        }

        // Emergency: elevated risks
        for (const e of emergencyPredictions) {
          if (e.probability >= 30) {
            const cls = e.type.toLowerCase();
            recs.push(`Prepare ${cls} response kit at ${e.location}; target response ${e.estimatedResponseTime} min.`);
          }
        }

        recommendations = this.dedupCap(recs, 8);
      }
    } catch {
      // Swallow errors and return safe defaults
    }

    // Always return arrays to keep UI .map() safe
    return {
      overallEfficiency,
      hotspots: hotspotsOut,
      hotspotAreas: hotspotsOut, // alias used by some UIs

      serviceDemand,
      serviceForecast: serviceDemand.map((s) => ({
        service: s.service,
        forecast: [], // charts read /analytics/trends
        peakHours: s.peakHours,
        priorityServices: [s.service],
      })),

      resourceAllocation,
      emergencyPredictions,
      recommendations,

      priorityServices: topLevelPriorityServices,
      lastUpdated,
      serverTime: new Date().toISOString(),
    };
  }

  // ====================== /analytics/trends ======================
  @get('/analytics/trends')
  @response(200, {description: 'Trends'})
  async trends() {
    let forecasts: Array<{
      service: string;
      used_model: string;
      forecast: Array<{date: string; yhat: number; yhat_lower: number; yhat_upper: number;}>;
      peakHours: string[];
      priorityServices: string[];
    }> = [];

    try {
      const packs = (await this.collection(`predictions_service_forecast${this.suffix()}`)
        .find({})
        .sort({date_generated: -1})
        .toArray()) as ServiceForecastDoc[];

      forecasts = packs.map((p) => ({
        service: asStr(p.service, 'Unknown'),
        used_model: asStr(p.used_model, 'baseline'),
        forecast: asArr<ForecastPoint>(p.forecast).map((d) => ({
          date: asStr(d.date, ''),
          yhat: asNum(d.yhat, 0),
          yhat_lower: asNum(d.yhat_lower, 0),
          yhat_upper: asNum(d.yhat_upper, 0),
        })),
        peakHours: [],
        priorityServices: [asStr(p.service, 'Unknown')],
      }));
    } catch {
      // keep empty forecasts
    }

    const totalMean = forecasts.reduce<number>(
      (acc, pack) => acc + pack.forecast.reduce<number>((a, d) => a + d.yhat, 0),
      0,
    );

    return {
      forecasts,         // main
      series: forecasts, // aliases some frontends use
      data: forecasts,
      narrative: '7-day outlook based on last 28-day seasonal baseline.',
      stats: {comparedRange: 'last 28 days', totalMean: Number(totalMean.toFixed(2))},
      priorityServices: forecasts.map((f) => f.service).slice(0, 3),
    };
  }
}
