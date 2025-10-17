import { openAIJson } from "./ai.service";

export interface Hotspot { location: string; score: number; recent: number; total: number; }
export interface Forecast { service: string; forecast: { date: string; yhat: number; yhat_lower: number; yhat_upper: number; }[] }
export interface EmergencyAgg { label: string; prob: number; }
export interface Staffing { plan: number[]; capacityPerStaffPerDay: number; }

export async function generateRecommendations(input: {
  hotspots: Hotspot[];
  forecasts: Forecast[];
  emergency: EmergencyAgg[];
  efficiency?: number;
  staffing: Staffing;
}) {
  const system = `You are an operations advisor for a barangay office. Return ONLY JSON per schema.
Write short, actionable recommendations (<= 18 words each). Use concrete locations/services and time windows (e.g., Tue-Thu 8–10AM).
Balance quick wins and high impact; include prevention where relevant.`;

  const user = input;

  const schema = {
    type: "object",
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            reason: { type: "string" },
            impact: { type: "string", enum: ["low","medium","high"] },
            priority: { type: "integer", minimum: 1, maximum: 5 }
          },
          required: ["title","reason","impact","priority"],
          additionalProperties: false
        }
      }
    },
    required: ["recommendations"],
    additionalProperties: false
  };

  return openAIJson<{ recommendations: { title: string; reason: string; impact: string; priority: number; }[] }>(
    system, user, schema
  );
}
