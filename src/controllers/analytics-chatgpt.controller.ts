import {get, response, param} from '@loopback/rest';
import {inject} from '@loopback/core';

import {SubmissionRepository, UserRepository} from '../repositories';
import {classifyEmergency, forecastServiceDemand, scoreHotspots} from '../services/ml.chatgpt';
import {generateRecommendations} from '../services/recommendations.chatgpt';
import {getRecentOpenAICalls, INTEGRATION_VERSION} from '../services/ai.service';

type ForecastPoint = { date: string; yhat: number; yhat_lower?: number; yhat_upper?: number };
type ForecastPack = { service: string; used_model: string; forecast: ForecastPoint[] };
type HotspotRow = { location: string; score: number; recent: number; total: number };

export class AnalyticsChatGPTController {
  constructor(
    @inject('repositories.SubmissionRepository') private submissionRepo: SubmissionRepository,
    @inject('repositories.UserRepository') private userRepo: UserRepository,
  ) {}

  @get('/analytics/ml-insights/chatgpt')
  @response(200, {description: 'AI/ML insights payload (ChatGPT-powered)', content: {'application/json': {schema: {type: 'object'}}}})
  async mlInsightsChatGPT(@param.query.boolean('debug') debug?: boolean, @param.query.boolean('force') force?: boolean) {
    return this._mlInsightsImpl({debug, force, source: 'chatgpt-v2'});
  }

  @get('/analytics/ml-insights/v2')
  @response(200, {description: 'AI/ML insights payload (ChatGPT-powered, alias)', content: {'application/json': {schema: {type: 'object'}}}})
  async mlInsightsV2(@param.query.boolean('debug') debug?: boolean, @param.query.boolean('force') force?: boolean) {
    return this._mlInsightsImpl({debug, force, source: 'chatgpt-v2'});
  }

  private async _mlInsightsImpl(opts: {debug?: boolean; force?: boolean; source: string}) {
    const {debug, force, source} = opts;
    const now = new Date();
    const start30ISO = new Date(now.getTime() - 30*24*60*60*1000).toISOString();
    const start90ISO = new Date(now.getTime() - 90*24*60*60*1000).toISOString();

    const subsLast90 = await this.submissionRepo.find({
      where: { createdAt: { gte: start90ISO } } as any,
      order: ['createdAt ASC'],
    });

    const perServiceHistory = groupDailyCountsByService(subsLast90);
    let services = Object.keys(perServiceHistory);
    const horizon = 7;

    if (force && services.length === 0) {
      services = ['Complaints','Document Requests','Barangay IDs'];
      const makeHist = () => Array.from({length: 90}, (_, i) => {
        const d = new Date(Date.now() - (89 - i)*86400000);
        const dow = d.getDay();
        const base = 10 + (dow === 1 || dow === 2 ? 5 : 0);
        return { date: d.toISOString().slice(0,10), count: base + Math.floor(Math.random()*4) };
      });
      services.forEach(s => (perServiceHistory as any)[s] = makeHist());
    }

    let forecasts: ForecastPack[] = [];
    try {
      forecasts = await Promise.all(
        services.map(async (s): Promise<ForecastPack> => {
          const out = await forecastServiceDemand(s, (perServiceHistory as any)[s] ?? [], horizon);
          return { service: out.service, used_model: out.used_model, forecast: (out.forecast ?? []) as ForecastPoint[] };
        })
      );
    } catch {
      forecasts = services.map((s): ForecastPack => ({ service: s, used_model: 'fallback-none', forecast: [] }));
    }

    const subsLast30 = subsLast90.filter(s => {
      const d = safeDate((s as any).createdAt);
      return d ? d.toISOString() >= start30ISO : false;
    });
    let complaints = subsLast30.filter(s => (s as any).submissionType?.toString().toLowerCase() === 'complaint');

    if (force && complaints.length === 0) {
      complaints = [
        {createdAt: new Date().toISOString(), submissionType: 'Complaint', category: 'Road', subject: 'Road flooded', details: 'Water near river bank', email: 'a@demo.local'},
        {createdAt: new Date().toISOString(), submissionType: 'Complaint', category: 'Fire', subject: 'Smoke reported', details: 'Light smoke in market', email: 'b@demo.local'},
        {createdAt: new Date().toISOString(), submissionType: 'Complaint', category: 'Medical', subject: 'Injury', details: 'Minor injury near plaza', email: 'c@demo.local'},
      ] as any[];
    }

    const emails = complaints.map(getEmailFromSubmission).filter(Boolean) as string[];
    const usersByEmail = await loadUsersByEmail(this.userRepo, emails);

    let perLocationSeries = groupDailyCountsByLocation(complaints, usersByEmail);
    let hotspotResult: { rankings: HotspotRow[]; method: string } = {rankings: [], method: 'none'};
    try { if (perLocationSeries.length) hotspotResult = await scoreHotspots(perLocationSeries); } catch { hotspotResult = {rankings: [], method: 'fallback-none'}; }

    let recentTexts = complaints.slice(-200).map(c => [ (c as any).category, (c as any).subject, getDetailText(c as any) ].filter(Boolean).join(' ').trim()).filter(Boolean);
    if (force && recentTexts.length === 0) {
      recentTexts = [
        'Severe flooding near river; barangay road knee-deep water',
        'Light smoke inside wet market; unclear source',
        'Resident slipped by plaza, minor bleeding, needs assistance',
      ];
    }

    let emergency: any = {classes: ['flood','fire','medical'], predictions: [] as Array<{probs: Array<{label: string; proba: number}>}>};
    try { if (recentTexts.length) emergency = await classifyEmergency(recentTexts); } catch {}

    const emergencySummary = aggregateEmergency(emergency.predictions);

    const capacityPerStaffPerDay = 12;
    const totalDemandPerDay = sumAcrossServices(forecasts, horizon);
    const staffPlan = totalDemandPerDay.map((d: number) => Math.ceil(d / capacityPerStaffPerDay));

    const completed = subsLast30.filter(s => (s as any).status?.toString().toLowerCase() === 'completed').length;
    const pending = subsLast30.filter(s => (s as any).status?.toString().toLowerCase() !== 'completed').length;
    const systemEfficiency = (completed + pending) ? completed / (completed + pending) : 0;

    const topHotspots = (hotspotResult.rankings || []).slice(0, 5);
    const forecastPack = forecasts.map((f: ForecastPack) => ({service: f.service, forecast: f.forecast}));

    let recos: {recommendations: Array<{title: string; reason: string; impact: string; priority: number}>} = {recommendations: []};
    try {
      recos = await generateRecommendations({
        hotspots: topHotspots as any,
        forecasts: forecastPack as any,
        emergency: emergencySummary as any,
        efficiency: systemEfficiency,
        staffing: { plan: staffPlan, capacityPerStaffPerDay }
      });
    } catch {}

    const serviceForecastCards = forecasts.map((f: ForecastPack) => ({
      service: f.service,
      predictedToday: Math.round((f.forecast?.[0]?.yhat ?? 0) as number),
      weekAhead: Math.round(((f.forecast ?? []).slice(0,7) as ForecastPoint[]).reduce((a: number, x: ForecastPoint) => a + (x?.yhat ?? 0), 0)),
      confidenceToday: Math.max(0, Math.min(100, Math.round(100 - ((((f.forecast?.[0]?.yhat_upper ?? 0) as number) - ((f.forecast?.[0]?.yhat_lower ?? 0) as number)))))),
      usedModel: f.used_model,
      daily: f.forecast
    }));

    
    // === UI-compatible payload for /analytics/ml-insights (match live endpoint) ===
    const nowISO = new Date().toISOString();

    // Map hotspots to expected UI shape
    const hotspots = (topHotspots || []).map((h: any) => ({
      location: h.location,
      riskScore: Math.max(0, Math.min(100, Math.round(h.score))),
      predictedComplaints: Math.max(h.recent || 0, Math.round(Math.max(1, h.total || 0) / 4)),
      commonIssues: [],
      recommendedActions: (h.score || 0) >= 70
        ? ['Increase patrols', 'Targeted community advisory', 'Pre-position resources']
        : ['Routine monitoring'],
    }));

    // Map forecasts to expected serviceDemand
    const serviceDemand = (forecasts || []).map((f: any) => {
      const forecastToday = f?.forecast?.[0]?.yhat ?? 0;
      const currentApprox = Math.round(forecastToday * 0.7);
      const predicted = Math.round(forecastToday);
      return {
        service: f.service,
        currentDemand: currentApprox,
        predictedDemand: predicted,
        confidence: 85,
        recommendedStaff: Math.max(1, Math.round(predicted / Math.max(1, capacityPerStaffPerDay/2))),
        peakHours: ['09:00-11:00', '14:00-16:00'],
      };
    });

    // Synthetic resource allocation (light heuristic)
    const halls = ['Manggahan Proper','Napico','Greenpark'];
    const resourceAllocation = serviceDemand.slice(0, 3).map((s, idx) => ({
      hall: halls[idx] || `Hall ${idx+1}`,
      currentLoad: Math.min(100, Math.max(30, s.currentDemand)),
      predictedLoad: Math.min(100, Math.max(40, s.predictedDemand)),
      efficiency: Math.max(50, Math.min(100, Math.round((systemEfficiency || 75) - (idx*2)))),
      recommendedStaff: s.recommendedStaff,
      priorityServices: [s.service],
    }));

    // Emergency to expected UI shape
    const emergencyPredictions = (emergency?.predictions || []).map((p: any) => ({
      type: p.label ? (p.label.charAt(0).toUpperCase() + p.label.slice(1) + ' Risk') : 'Emergency Risk',
      location: 'General Area',
      probability: Math.round((p.prob ?? 0) * 100),
      estimatedResponseTime: 10,
      requiredResources: ['Response team', 'Medical kit'],
      preventiveMeasures: ['Public advisory', 'Equipment readiness'],
    }));

    const recommendations = (recos?.recommendations || []).map((r: any) => (
      r?.title && r?.impact ? `${r.title} — ${r.impact}` : (r?.text || r?.title || 'Operational improvement')
    ));

    const overallEfficiency = Math.max(50, Math.min(100, Math.round(systemEfficiency || 76)));

    if (debug) {
      return {
        overallEfficiency,
        hotspots,
        serviceDemand,
        resourceAllocation,
        emergencyPredictions,
        recommendations,
        lastUpdated: nowISO,
        serverTime: nowISO,
        _debug: { model: process.env.OPENAI_MODEL || process.env.OPENAI_FALLBACK_CHAT_MODEL || 'gpt-4o-mini' }
      };
    }

    return {
      overallEfficiency,
      hotspots,
      serviceDemand,
      resourceAllocation,
      emergencyPredictions,
      recommendations,
      lastUpdated: nowISO,
      serverTime: nowISO,
    };
}
}

/* helpers (same as before) */
type LBSubmission = { createdAt?: string | Date; submissionType?: string; status?: string; category?: string; subject?: string; details?: string; description?: string; message?: string; createdByEmail?: string; email?: string; userEmail?: string; createdBy?: string; };
type UserLite = { email?: string; purok?: string; street?: string; barangayHall?: string; };
function safeDate(d?: string | Date): Date | null { if (!d) return null; if (d instanceof Date) return d; const x = new Date(d); return isNaN(+x) ? null : x; }
function dateKey(d: Date) { return d.toISOString().slice(0,10); }
function normalizeService(svc?: string) { const x = (svc || '').toLowerCase(); if (x === 'document') return 'Document Requests'; if (x === 'complaint') return 'Complaints'; return svc || 'Unknown'; }
function getEmailFromSubmission(s: LBSubmission): string | null { const candidates = [s.createdByEmail, s.userEmail, s.email, s.createdBy].filter(Boolean) as string[]; const hit = candidates.find(e => typeof e === 'string' && e.includes('@')); return hit ?? null; }
function getDetailText(s: LBSubmission): string { return (s.details || s.description || s.message || '').toString(); }
function groupDailyCountsByService(subs: LBSubmission[]) { const byService: Record<string, Record<string, number>> = {}; subs.forEach(s => { const dt = safeDate(s.createdAt); if (!dt) return; const svc = normalizeService(s.submissionType); const key = dateKey(dt); byService[svc] = byService[svc] || {}; byService[svc][key] = (byService[svc][key] || 0) + 1; }); const end = new Date(); const start = new Date(end.getTime() - 90*24*60*60*1000); const dates: string[] = []; for (let t = new Date(start); t <= end; t = new Date(t.getTime() + 86400000)) dates.push(dateKey(t)); const out: Record<string, {date: string; count: number}[]> = {}; Object.keys(byService).forEach(svc => { out[svc] = dates.map(d => ({date: d, count: byService[svc][d] || 0})); }); return out; }
async function loadUsersByEmail(userRepo: any, emails: string[]) { const unique = Array.from(new Set(emails)); if (!unique.length) return {} as Record<string, UserLite>; const users = await userRepo.find({ where: { email: { inq: unique } } }); const map: Record<string, UserLite> = {}; (users || []).forEach((u: any) => { const e = (u.email || '').toString().toLowerCase(); if (e) map[e] = u; }); return map; }
function formatLocation(u?: UserLite) { const parts: string[] = []; if (u?.purok) parts.push(`Purok ${u.purok}`); if (u?.street) parts.push(u.street); if (u?.barangayHall) parts.push(u.barangayHall); if (!parts.length) parts.push('General Area'); return parts.join(' • '); }
function groupDailyCountsByLocation(complaints: LBSubmission[], usersByEmail: Record<string, UserLite>) { const byLoc: Record<string, Record<string, number>> = {}; complaints.forEach(c => { const dt = safeDate(c.createdAt); if (!dt) return; const email = getEmailFromSubmission(c); const u = email ? usersByEmail[(email || '').toLowerCase()] : undefined; const loc = formatLocation(u); const key = dateKey(dt); byLoc[loc] = byLoc[loc] || {}; byLoc[loc][key] = (byLoc[loc][key] || 0) + 1; }); const end = new Date(); const start = new Date(end.getTime() - 30*24*60*60*1000); const dates: string[] = []; for (let t = new Date(start); t <= end; t = new Date(t.getTime() + 86400000)) dates.push(dateKey(t)); const out: Array<{location: string; history: {date: string; count: number}[]}> = []; Object.keys(byLoc).forEach(loc => { out.push({ location: loc, history: dates.map(d => ({date: d, count: byLoc[loc][d] || 0})) }); }); return out; }
function aggregateEmergency(predictions: {probs: {label: string; proba: number}[]}[]) { const agg: Record<string, number> = { flood: 0, fire: 0, medical: 0 }; (predictions || []).forEach(p => { (p.probs || []).forEach(pp => { agg[pp.label] = (agg[pp.label] || 0) + (pp.proba || 0); }); }); const total = Object.values(agg).reduce((a, b) => a + b, 0) || 1; return Object.entries(agg).map(([label, v]) => ({ label, prob: v / total })); }
function sumAcrossServices(forecasts: ForecastPack[], horizon: number) { const byDay: number[] = Array.from({length: horizon}, () => 0); (forecasts || []).forEach((f: ForecastPack) => { for (let d = 0; d < horizon; d++) { byDay[d] += f.forecast?.[d]?.yhat ?? 0; } }); return byDay; }
