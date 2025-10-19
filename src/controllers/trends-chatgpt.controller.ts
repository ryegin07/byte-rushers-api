
import {get, response, param} from '@loopback/rest';
import {inject} from '@loopback/core';
import {SubmissionRepository} from '../repositories';
import {openAIJson} from '../services/ai.service';

type SeriesPoint = {date: string; value: number};
type TrendCard = { metric: string; direction: 'up'|'down'|'flat'; pctChange: number; spark: SeriesPoint[] };
type Anomaly = { date: string; metric: string; z: number; note: string };

export class TrendsChatGPTController {
  constructor(
    @inject('repositories.SubmissionRepository') private submissionRepo: SubmissionRepository,
  ) {}

  @get('/analytics/trends/v2')
  @response(200, {description: 'AI Trends v2'})
  async trendsV2(
    @param.query.boolean('debug') debug?: boolean,
    @param.query.boolean('force') force?: boolean,
    @param.query.string('format') format?: string, // 'legacy' to transform
  ) {
    return this._impl({debug, force, source:'trends-v2', format});
  }

  @get('/analytics/trends/chatgpt')
  @response(200, {description: 'AI Trends (alias)'})
  async trendsChatGPT(
    @param.query.boolean('debug') debug?: boolean,
    @param.query.boolean('force') force?: boolean,
    @param.query.string('format') format?: string, // 'legacy' to transform
  ) {
    return this._impl({debug, force, source:'trends-v2', format});
  }

  private async _impl(opts: {debug?: boolean; force?: boolean; source: string; format?: string}) {
    const {debug, force, source, format} = opts;
    const now = new Date();
    const day = (n:number)=>new Date(now.getTime() - n*86400000).toISOString().slice(0,10);

    const startISO = new Date(now.getTime() - 60*86400000).toISOString();
    const subs = await this.submissionRepo.find({ where: {createdAt: {gte: startISO}} as any, order: ['createdAt ASC'] });

    const metrics = ['Complaints','Document Requests','Barangay IDs'];
    const days: string[] = Array.from({length: 60}, (_,i)=>day(59-i));
    const series: Record<string, Array<SeriesPoint>> = {};
    metrics.forEach(m => series[m] = days.map(d => ({date:d, value:0})));

    subs.forEach((s:any) => {
      const d = (s.createdAt ? new Date(s.createdAt) : null);
      if (!d || isNaN(+d)) return;
      const date = d.toISOString().slice(0,10);
      const metric = normalizeMetric(s.submissionType);
      const row = series[metric]?.find(x => x.date === date);
      if (row) row.value += 1;
    });

    if (force && metrics.every(m => series[m].every(x => x.value===0))) {
      metrics.forEach((m,idx) => {
        series[m] = days.map((d,i)=>({date:d, value: 6 + ((i+idx)%7===0?5:0) + Math.floor(Math.random()*3)}));
      });
    }

    const system = `You are a municipal analytics engine. Given per-metric daily counts for ~60 days,
identify week-over-week trends, compute % change, flag anomalies (z-score style), and write a short narrative.
Return ONLY JSON matching the schema.`;
    const schema = {
      type: 'object',
      properties: {
        trends: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              metric: {type:'string'},
              direction: {type:'string', enum:['up','down','flat']},
              pctChange: {type:'number'},
              spark: {
                type:'array',
                items: {type:'object', properties:{date:{type:'string'}, value:{type:'number'}}, required:['date','value'], additionalProperties:false}
              }
            },
            required: ['metric','direction','pctChange','spark'],
            additionalProperties: false
          }
        },
        anomalies: {
          type:'array',
          items:{type:'object', properties:{date:{type:'string'}, metric:{type:'string'}, z:{type:'number'}, note:{type:'string'}},
          required:['date','metric','z','note'], additionalProperties:false}
        },
        narrative: {type:'string'},
        stats: {
          type:'object',
          properties:{
            comparedRange: {type:'string'},
            totalMetrics: {type:'number'}
          },
          required:['comparedRange','totalMetrics'],
          additionalProperties:false
        }
      },
      required: ['trends','anomalies','narrative','stats'],
      additionalProperties: false
    };

    let out: {trends: TrendCard[]; anomalies: Anomaly[]; narrative: string; stats: {comparedRange: string; totalMetrics: number}};
    try {
      out = await openAIJson(system, { series, compare: 'last_7_vs_prev_7', days }, schema, {cacheTtlMs: 5*60*1000});
    } catch (e) {
      out = {trends: [], anomalies: [], narrative: '', stats: {comparedRange: 'n/a', totalMetrics: Object.keys(series).length}};
    }

    const v2 = {
      source,
      lastUpdated: new Date().toISOString(),
      trends: out.trends,
      anomalies: out.anomalies,
      narrative: out.narrative,
      stats: out.stats,
    };

    
    if ((format || '').toLowerCase() === 'legacy') {
      const legacy = toLegacyFormat(days, out);
      return { source, lastUpdated: v2.lastUpdated, ...legacy };
    }

    function toTrendLabel(dir: 'up'|'down'|'flat'|string): 'up'|'down'|'stable'|'flat' {
      if (dir === 'flat') return 'flat';
      if (dir === 'up' || dir === 'down') return dir as any;
      return 'stable';
    }

    const complaintTrends = (v2.trends || [])
      .filter((t: any) => /complaint|issue|incident/i.test(t.metric))
      .map((t: any) => ({
        category: t.metric,
        trend: toTrendLabel(t.direction),
        percentage: Math.round(t.pctChange ?? 0),
      }));

    const serviceTrends = (v2.trends || [])
      .filter((t: any) => /service|request|document|clearance|id/i.test(t.metric) && !/complaint|issue|incident/i.test(t.metric))
      .map((t: any) => ({
        service: t.metric,
        trend: toTrendLabel(t.direction),
        percentage: Math.round(t.pctChange ?? 0),
      }));

    return {
      complaintTrends,
      serviceTrends,
      lastUpdated: v2.lastUpdated,
      serverTime: now.toISOString(),
    };
    }
}

function normalizeMetric(t?: string) {
  const x = (t||'').toLowerCase();
  if (x.includes('complaint')) return 'Complaints';
  if (x.includes('document')) return 'Document Requests';
  if (x.includes('id')) return 'Barangay IDs';
  return 'Other';
}

function toLegacyFormat(days: string[], v2: {trends: Array<{metric: string; direction: 'up'|'down'|'flat'; pctChange: number; spark: Array<{date: string; value: number}>}>; anomalies: Array<{date:string; metric:string; z:number; note:string}>; narrative: string}) {
  const cards = v2.trends.map(t => ({
    title: t.metric,
    direction: t.direction,
    pctChange: t.pctChange,
    current: t.spark.length ? t.spark[t.spark.length-1].value : 0,
    previous: t.spark.length > 7 ? t.spark[t.spark.length-8].value : 0
  }));

  const datasets = v2.trends.map(t => ({
    label: t.metric,
    data: days.map(d => {
      const p = t.spark.find(s => s.date === d);
      return p ? p.value : 0;
    })
  }));

  return {
    cards,
    chart: { labels: days, datasets },
    anomalies: v2.anomalies,
    narrative: v2.narrative
  };
}
