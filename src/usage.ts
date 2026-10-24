import { fetch } from "@tauri-apps/plugin-http";

export interface TavilyUsage {
  key: {
    usage: number;
    limit: number | null;
    searchUsage: number;
    extractUsage: number;
    crawlUsage: number;
    mapUsage: number;
    researchUsage: number;
  };
  account: {
    currentPlan: string;
    planUsage: number;
    planLimit: number | null;
    paygoUsage: number;
    paygoLimit: number | null;
  };
}

export interface DeepgramUsageDay {
  date: string;
  hours: number;
  requests: number;
}

export interface DeepgramBalance {
  id: string;
  amount: number;
  units: string;
  purchaseOrderId: string;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function checkResponse(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  let message = "";
  try {
    const body = object(await response.json());
    const detail = object(body.detail);
    const error = object(body.error);
    const candidates = [
      detail.error,
      detail.message,
      detail.details,
      body.err_msg,
      body.message,
      error.message,
      error.err_msg,
      error.details,
      typeof body.error === "string" ? body.error : "",
    ];
    message = candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0) ?? "";
  } catch {
    message = "";
  }
  if (response.status === 403 && provider === "Deepgram usage") {
    throw new Error(`Deepgram denied project usage access (403). Confirm the API key has usage:read access to this project.${message ? ` Deepgram: ${message}` : ""}`);
  }
  if (response.status === 403 && provider === "Deepgram balance") {
    throw new Error("Deepgram denied balance access (403). The management key needs the project billing:read permission.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${provider} rejected the API key or its permissions. Check the key and account access in Settings.`);
  }
  throw new Error(`${provider} request failed (HTTP ${response.status})${message ? `: ${message}` : ""}`);
}

export async function fetchTavilyUsage(apiKey: string, signal: AbortSignal): Promise<TavilyUsage> {
  const response = await fetch("https://api.tavily.com/usage", {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    signal,
  });
  await checkResponse(response, "Tavily");
  const body = object(await response.json());
  const key = object(body.key);
  const account = object(body.account);
  return {
    key: {
      usage: number(key.usage),
      limit: optionalNumber(key.limit),
      searchUsage: number(key.search_usage),
      extractUsage: number(key.extract_usage),
      crawlUsage: number(key.crawl_usage),
      mapUsage: number(key.map_usage),
      researchUsage: number(key.research_usage),
    },
    account: {
      currentPlan: String(account.current_plan ?? "Current plan"),
      planUsage: number(account.plan_usage),
      planLimit: optionalNumber(account.plan_limit),
      paygoUsage: number(account.paygo_usage),
      paygoLimit: optionalNumber(account.paygo_limit),
    },
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function fetchDeepgramDailyUsage(
  apiKey: string,
  projectId: string,
  days: number,
  signal: AbortSignal,
): Promise<DeepgramUsageDay[]> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - Math.max(1, days - 1));
  const project = encodeURIComponent(projectId.trim());
  const headers = { Authorization: `Token ${apiKey.trim()}` };
  const params = new URLSearchParams({
    start: formatDate(startDate),
    end: formatDate(endDate),
  });
  const base = `https://api.deepgram.com/v1/projects/${project}`;
  const usageResponse = await fetch(`${base}/usage/breakdown?${params}`, { headers, signal });
  await checkResponse(usageResponse, "Deepgram usage");

  const usageBody = object(await usageResponse.json());
  const usageRows = Array.isArray(usageBody.results) ? usageBody.results : [];
  const dailyUsage = new Map<string, DeepgramUsageDay>();
  usageRows.forEach((row) => {
    const item = object(row);
    const grouping = object(item.grouping);
    const date = String(grouping.start ?? "");
    if (!date) return;
    const day = dailyUsage.get(date) ?? { date, hours: 0, requests: 0 };
    day.hours += number(item.hours);
    day.requests += number(item.requests);
    dailyUsage.set(date, day);
  });
  return [...dailyUsage.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export async function fetchDeepgramBalances(
  apiKey: string,
  projectId: string,
  signal: AbortSignal,
): Promise<DeepgramBalance[]> {
  const project = encodeURIComponent(projectId.trim());
  const response = await fetch(`https://api.deepgram.com/v1/projects/${project}/balances`, {
    headers: { Authorization: `Token ${apiKey.trim()}` },
    signal,
  });
  await checkResponse(response, "Deepgram balance");
  const body = object(await response.json());
  const balances = Array.isArray(body.balances) ? body.balances : [];
  return balances.map((row) => {
    const item = object(row);
    return {
      id: String(item.balance_id ?? ""),
      amount: number(item.amount),
      units: String(item.units ?? ""),
      purchaseOrderId: String(item.purchase_order_id ?? ""),
    };
  });
}
