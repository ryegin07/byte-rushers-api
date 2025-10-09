
import {inject} from '@loopback/core';
import {get, response} from '@loopback/rest';
import {repository} from '@loopback/repository';
import {SubmissionRepository} from '../repositories/submission.repository';
import {UserRepository} from '../repositories/user.repository';
import {Submission} from '../models';

/* TypeScript interfaces mirror the Web UI expectations */
type TrendDir = 'up'|'down'|'flat';

interface HotspotPrediction {
  location: string;
  riskScore: number;
  predictedComplaints: number;
  commonIssues: string[];
  recommendedActions: string[];
}

interface ServiceDemandForecast {
  service: string;
  currentDemand: number;
  predictedDemand: number;
  confidence: number;
  recommendedStaff: number;
  peakHours: string[];
}

interface ResourceAllocation {
  hall: string;
  currentLoad: number;
  predictedLoad: number;
  efficiency: number;
  recommendedStaff: number;
  priorityServices: string[];
}

interface EmergencyPrediction {
  type: string;
  location: string;
  probability: number;
  estimatedResponseTime: number;
  requiredResources: string[];
  preventiveMeasures: string[];
}

interface MLInsights {
  overallEfficiency: number;
  hotspots: HotspotPrediction[];
  serviceDemand: ServiceDemandForecast[];
  resourceAllocation: ResourceAllocation[];
  emergencyPredictions: EmergencyPrediction[];
  recommendations: string[];
  lastUpdated?: string;
  serverTime?: string;
}

interface TrendAnalysis {
  complaintTrends: {category: string; trend: TrendDir; percentage: number;}[];
  serviceTrends: {service: string; trend: TrendDir; percentage: number;}[];
  lastUpdated?: string;
  serverTime?: string;
}

function startOfDay(d: Date){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function daysAgo(n: number){ const d=new Date(); d.setDate(d.getDate()-n); return d; }
function percentDelta(a: number, b: number){ if (b===0) return a>0?100:0; return Math.round(((a-b)/b)*100); }
function clamp(n:number,min:number,max:number){return Math.max(min, Math.min(max, n));}

export class AnalyticsController {
  constructor(
    @repository(SubmissionRepository) private submissionRepo: SubmissionRepository,
    @repository(UserRepository) private userRepo: UserRepository,
  ) {}

  @get('/analytics/ml-insights')
  @response(200, {description: 'ML Insights (computed from live data)'})
  async getMlInsights(): Promise<MLInsights> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekAgo = daysAgo(7);
    const monthAgo = daysAgo(30);

    const recentSubs = await this.submissionRepo.find({
      where: { createdAt: { gte: monthAgo.toISOString() } },
      order: ['createdAt DESC'],
    });

    const emails = Array.from(new Set(recentSubs.map(s => (s as any).email).filter(Boolean)));
    const users = emails.length ? await this.userRepo.find({ where: { email: { inq: emails }}}) : [];
    const userMap = new Map(users.map(u => [u.email, u as any]));

    const subToLocation = (s: Submission): string => {
      const u: any = s.email ? userMap.get(s.email) : undefined;
      const parts: string[] = [];
      if (u?.purok) parts.push(u.purok);
      if (u?.street) parts.push(u.street);
      if (u?.barangayHall) parts.push(u.barangayHall);
      return parts.length ? parts.join(' - ') : (u?.barangayHall || 'General Area');
    };

    const todaySubs = recentSubs.filter(s => s.createdAt && new Date(s.createdAt) >= todayStart);
    const sevenDaySubs = recentSubs.filter(s => s.createdAt && new Date(s.createdAt) >= weekAgo);
    const complaintSubs = recentSubs.filter(s => s.submissionType === 'Complaint');
    const documentSubs = recentSubs.filter(s => s.submissionType === 'Document');

    const hotspotMap = new Map<string, Submission[]>();
    for (const s of complaintSubs) {
      const loc = subToLocation(s);
      const arr = hotspotMap.get(loc) || [];
      arr.push(s);
      hotspotMap.set(loc, arr);
    }
    const hotspotEntries = Array.from(hotspotMap.entries()).map(([loc, arr]) => ({
      location: loc,
      count: arr.length,
      recent: arr.filter(s => s.createdAt && new Date(s.createdAt) >= weekAgo).length,
      issues: topKeywords(arr, 5),
    }));
    const maxCount = hotspotEntries.reduce((m,e)=>Math.max(m,e.count), 0) || 1;
    const hotspots = hotspotEntries
      .sort((a,b)=>b.count-a.count)
      .slice(0,6)
      .map(e => ({
        location: e.location,
        riskScore: Math.round((e.recent / Math.max(1, e.count)) * 100 * 0.4 + (e.count / maxCount) * 100 * 0.6),
        predictedComplaints: Math.max(e.recent, Math.round(e.count/4)+1),
        commonIssues: e.issues,
        recommendedActions: recommendForIssues(e.issues),
      }));

    const perService = (subs: Submission[]) => {
      const map = new Map<string, number>();
      for (const s of subs) {
        const key = s.submissionType || 'Other';
        map.set(key, (map.get(key)||0)+1);
      }
      return map;
    };
    const todayByService = perService(todaySubs);
    const weekByService = perService(sevenDaySubs);
    const services = Array.from(new Set([...todayByService.keys(), ...weekByService.keys()]));
    const serviceDemand = services.map(svc => {
      const cur = todayByService.get(svc) || 0;
      const wk = weekByService.get(svc) || 0;
      const avg = Math.round(wk / 7);
      const predicted = Math.max(cur, avg);
      const confidence = clamp(60 + Math.min(40, wk*2), 60, 95);
      const recommendedStaff = Math.ceil(predicted / 12) || 1;
      const peakHours = estimatePeakHours(sevenDaySubs.filter(s => (s.submissionType||'Other')===svc));
      return { service: svc==='Document'?'Document Requests':(svc==='Complaint'?'Complaint Processing':svc), currentDemand: cur, predictedDemand: predicted, confidence, recommendedStaff, peakHours };
    });

    const hallMap = new Map<string, {pending:number; completed:number; all:number;}>();
    for (const s of recentSubs) {
      const u:any = s.email ? userMap.get(s.email) : undefined;
      const hall = u?.barangayHall || 'General Hall';
      const entry = hallMap.get(hall) || {pending:0, completed:0, all:0};
      entry.all += 1;
      const status = (s.status||'').toLowerCase();
      if (['pending','active','ready'].includes(status)) entry.pending += 1;
      if (status === 'completed') entry.completed += 1;
      hallMap.set(hall, entry);
    }
    const resourceAllocation = Array.from(hallMap.entries()).map(([hall, m]) => {
      const efficiency = clamp(Math.round((m.completed / Math.max(1, m.all)) * 100), 40, 95);
      const predictedLoad = clamp(m.pending + Math.round((m.all/30)*2), 0, 100);
      const recommendedStaff = Math.max(1, Math.ceil(predictedLoad/40));
      const priorityServices = serviceDemand.slice().sort((a,b)=>b.predictedDemand-a.predictedDemand).slice(0,2).map(s=>s.service);
      return { hall, currentLoad: clamp(m.pending, 0, 100), predictedLoad, efficiency, recommendedStaff, priorityServices };
    });

    const emergencies = computeEmergencies(complaintSubs, userMap);

    const overallEfficiency = resourceAllocation.length
      ? Math.round(resourceAllocation.reduce((a,b)=>a+b.efficiency,0)/resourceAllocation.length)
      : 75;

    return {
      overallEfficiency,
      hotspots,
      serviceDemand,
      resourceAllocation,
      emergencyPredictions: emergencies,
      recommendations: buildRecommendations(hotspots, serviceDemand, resourceAllocation),
      lastUpdated: now.toISOString(),
      serverTime: now.toISOString(),
    };
  }

  @get('/analytics/trends')
  @response(200, {description: 'Trend Analysis (computed from live data)'})
  async getTrends(): Promise<any> {
    const now = new Date();
    const weekAgo = daysAgo(7);
    const prevWeekStart = daysAgo(14);

    const lastWeek = await this.submissionRepo.find({
      where: { createdAt: { gte: weekAgo.toISOString() } },
    });
    const prevWeek = await this.submissionRepo.find({
      where: {
        and: [
          { createdAt: { gte: prevWeekStart.toISOString() } },
          { createdAt: { lt: weekAgo.toISOString() } },
        ],
      },
    });

    const byCat = (subs: Submission[]) => {
      const m = new Map<string, number>();
      for (const s of subs) {
        const cat = (s as any).category || s.submissionType || 'Other';
        m.set(cat, (m.get(cat)||0)+1);
      }
      return m;
    };
    const lastCat = byCat(lastWeek);
    const prevCat = byCat(prevWeek);

    const categories = Array.from(new Set([...lastCat.keys(), ...prevCat.keys()]));
    const complaintTrends = categories.map(cat => {
      const a = lastCat.get(cat) || 0;
      const b = prevCat.get(cat) || 0;
      const delta = percentDelta(a,b);
      const trend: TrendDir = delta > 5 ? 'up' : (delta < -5 ? 'down' : 'flat');
      return {category: cat, trend, percentage: Math.abs(delta)};
    }).slice(0,6);

    const services = ['Document','Complaint','Inquiry'];
    const serviceTrends = services.map(svc => {
      const a = lastWeek.filter(s => s.submissionType === svc).length;
      const b = prevWeek.filter(s => s.submissionType === svc).length;
      const delta = percentDelta(a,b);
      const trend: TrendDir = delta > 5 ? 'up' : (delta < -5 ? 'down' : 'flat');
      return {service: svc==='Document'?'Document Requests':(svc==='Complaint'?'Complaint Processing':svc), trend, percentage: Math.abs(delta)};
    });

    return { complaintTrends, serviceTrends, lastUpdated: now.toISOString(), serverTime: now.toISOString() };
  }
}

function sanitize(text?: string): string {
  return (text || '').toLowerCase();
}

function topKeywords(subs: Submission[], limit=5): string[] {
  const bag = new Map<string, number>();
  for (const s of subs) {
    const txt = [sanitize((s as any).issue), sanitize((s as any).details), sanitize((s as any).description)].join(' ');
    for (const w of txt.split(/[^a-z]+/).filter(Boolean)) {
      if (w.length < 4) continue;
      bag.set(w, (bag.get(w)||0)+1);
    }
  }
  return Array.from(bag.entries()).sort((a,b)=>b[1]-a[1]).slice(0, limit).map(([w]) => capitalize(w));
}

function recommendForIssues(issues: string[]): string[] {
  const outs: string[] = [];
  for (const i of issues.slice(0,3)) {
    if (/flood|drain|clog/i.test(i)) outs.push('Clear drainage & pre-position pumps');
    else if (/garbage|waste/i.test(i)) outs.push('Schedule extra garbage pick-up');
    else if (/light|lamp|street/i.test(i)) outs.push('Dispatch electrical maintenance team');
  }
  if (!outs.length) outs.push('Assign inspection team and notify residents');
  return Array.from(new Set(outs));
}

function estimatePeakHours(subs: Submission[]): string[] {
  const buckets = new Map<number, number>();
  for (const s of subs) {
    const d = s.createdAt ? new Date(s.createdAt) : null;
    if (!d) continue;
    const h = d.getHours();
    buckets.set(h, (buckets.get(h)||0)+1);
  }
  const top = Array.from(buckets.entries()).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([h])=>h);
  return top.map(h => `${String(h).padStart(2,'0')}:00-${String((h+2)%24).padStart(2,'0')}:00`);
}

function computeEmergencies(complaints: Submission[], userMap: Map<string, any>): any[] {
  const groups: {[k:string]: string[]} = {
    'Flood Risk': ['flood','rain','drain','overflow','river'],
    'Fire Hazard': ['fire','smoke','burn','electrical'],
    'Medical Emergency': ['injury','medical','accident'],
  };
  const counters: {[k:string]: number} = {'Flood Risk':0,'Fire Hazard':0,'Medical Emergency':0};
  const sampleLoc = (s: Submission): string => {
    const u: any = s.email ? userMap.get(s.email) : undefined;
    return u?.purok ? `${u.purok}${u.barangayHall? ' - ' + u.barangayHall : ''}` : (u?.barangayHall || 'General Area');
  };

  for (const s of complaints) {
    const t = sanitize((s as any).issue) + ' ' + sanitize((s as any).details) + ' ' + sanitize((s as any).description);
    for (const k of Object.keys(groups)) {
      if (groups[k].some(word => t.includes(word))) counters[k]++;
    }
  }

  const total = complaints.length || 1;
  const mk = (type: string) => ({
    type,
    location: complaints.length ? sampleLoc(complaints[0]) : 'General Area',
    probability: Math.round((counters[type] / total) * 100),
    estimatedResponseTime: clamp(5 + Math.round((1 - counters[type]/Math.max(1,total))*10), 5, 20),
    requiredResources: type==='Flood Risk' ? ['Water pump','Evac team','Ambulance'] :
                      type==='Fire Hazard' ? ['Fire truck','Medic'] :
                      ['Ambulance','First responders'],
    preventiveMeasures: type==='Flood Risk' ? ['Clear drainage','Pre-position pumps'] :
                        type==='Fire Hazard' ? ['Inspect wiring','Ban illegal LPG refills'] :
                        ['Stock first-aid kits','Community hotline'],
  });

  return ['Flood Risk','Fire Hazard','Medical Emergency'].map(mk);
}

function buildRecommendations(hs: any[], sd: any[], ra: any[]): string[] {
  const out = new Set<string>();
  if (hs[0] && hs[0].riskScore > 70) out.add(`Pre-position pumps near ${hs[0].location}`);
  const topSvc = sd.slice().sort((a,b)=>b.predictedDemand-a.predictedDemand)[0];
  if (topSvc) out.add(`Assign +${topSvc.recommendedStaff} staff to ${topSvc.service} during peak hours`);
  const lowEff = ra.slice().sort((a,b)=>a.efficiency-b.efficiency)[0];
  if (lowEff && lowEff.efficiency < 70) out.add(`Audit process at ${lowEff.hall} to improve efficiency`);
  return Array.from(out);
}

function capitalize(s: string){ return s.charAt(0).toUpperCase()+s.slice(1); }
