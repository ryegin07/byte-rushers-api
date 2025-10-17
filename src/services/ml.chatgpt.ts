import { openAIJson } from "./ai.service";

/** A) Emergency classification */
export async function classifyEmergency(texts: string[]) {
  const system = `You are a municipal analytics model. Return ONLY valid JSON per schema.
Label each text as one of: flood, fire, medical. Provide probabilities that sum to 1.`;
  const user = { texts };
  const schema = {
    type: "object",
    properties: {
      classes: { type: "array", items: { type: "string", enum: ["flood","fire","medical"] } },
      predictions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            probs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", enum: ["flood","fire","medical"] },
                  proba: { type: "number", minimum: 0, maximum: 1 }
                },
                required: ["label","proba"],
                additionalProperties: false
              }
            }
          },
          required: ["text","probs"],
          additionalProperties: false
        }
      }
    },
    required: ["classes","predictions"],
    additionalProperties: false
  };
  return openAIJson<{classes:string[]; predictions:{text:string; probs:{label:string; proba:number}[]}[]}>(system, user, schema);
}

/** B) Forecast service demand */
export async function forecastServiceDemand(
  service: string,
  history: Array<{date: string; count: number}>,
  horizon = 7
) {
  const system = `You are a time-series forecaster for public service workloads.
Given daily (date,count) history, produce the next H days with mean forecast and 95% CI.
Respect any visible weekly pattern. Avoid unrealistic jumps. Return ONLY the JSON per the schema.`;
  const user = { service, horizon, history };
  const schema = {
    type: "object",
    properties: {
      service: { type: "string" },
      used_model: { type: "string" },
      forecast: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" },
            yhat: { type: "number", minimum: 0 },
            yhat_lower: { type: "number", minimum: 0 },
            yhat_upper: { type: "number", minimum: 0 }
          },
          required: ["date","yhat","yhat_lower","yhat_upper"],
          additionalProperties: false
        }
      }
    },
    required: ["service","used_model","forecast"],
    additionalProperties: false
  };
  return openAIJson<{service:string; used_model:string; forecast:{date:string;yhat:number;yhat_lower:number;yhat_upper:number}[]}>(system, user, schema);
}

/** C) Hotspot scoring by location */
export async function scoreHotspots(
  locationSeries: Array<{location: string; history: {date: string; count: number}[]}>
) {
  const system = `You evaluate complaint hotspots.
For each location's 30-day (date,count) history, compute:
- time-decayed spike score 0..100 (recent days weigh more; ~7-day half-life),
- recent = last 7 days total,
- total = last 30 days total.
Return results sorted by score desc. Return ONLY the JSON per schema.`;
  const user = { locations: locationSeries };
  const schema = {
    type: "object",
    properties: {
      rankings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            location: { type: "string" },
            score: { type: "number", minimum: 0, maximum: 100 },
            recent: { type: "integer", minimum: 0 },
            total: { type: "integer", minimum: 0 }
          },
          required: ["location","score","recent","total"],
          additionalProperties: false
        }
      },
      method: { type: "string" }
    },
    required: ["rankings","method"],
    additionalProperties: false
  };
  return openAIJson<{rankings:{location:string;score:number;recent:number;total:number}[]; method:string}>(system, user, schema);
}
