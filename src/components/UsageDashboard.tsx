import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertCircle, AudioLines, Gauge, RefreshCw, Search, Settings2 } from "lucide-react";
import type { Settings } from "../settings";
import {
  fetchDeepgramBalances,
  fetchDeepgramDailyUsage,
  fetchTavilyUsage,
  type DeepgramBalance,
  type DeepgramUsageDay,
  type TavilyUsage,
} from "../usage";

interface Props {
  settings: Settings;
  onOpenSettings: () => void;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatHours(value: number): string {
  if (value < 0.01 && value > 0) return "<0.01";
  return value.toFixed(value < 10 ? 2 : 1);
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
}

function sevenDayUsage(days: DeepgramUsageDay[] | null): DeepgramUsageDay[] {
  const usageByDate = new Map(days?.map((day) => [day.date, day]) ?? []);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (6 - index));
    const dateKey = date.toISOString().slice(0, 10);
    return usageByDate.get(dateKey) ?? { date: dateKey, hours: 0, requests: 0 };
  });
}

function UsageBar({ value, limit }: { value: number; limit: number | null }) {
  const percent = limit && limit > 0 ? Math.min(100, (value / limit) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-bg">
      <div
        className="h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Search;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        <Icon size={15} className="text-accent" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function ProviderError({ message }: { message: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export default function UsageDashboard({ settings, onOpenSettings }: Props) {
  const deepgramApiKey = settings.deepgramManagementKey.trim() || settings.deepgramKey.trim();
  const [tavily, setTavily] = useState<TavilyUsage | null>(null);
  const [deepgramDays, setDeepgramDays] = useState<DeepgramUsageDay[] | null>(null);
  const [deepgramBalances, setDeepgramBalances] = useState<DeepgramBalance[] | null>(null);
  const [tavilyError, setTavilyError] = useState("");
  const [deepgramUsageError, setDeepgramUsageError] = useState("");
  const [deepgramBalanceError, setDeepgramBalanceError] = useState("");
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setTavilyError("");
    setDeepgramUsageError("");
    setDeepgramBalanceError("");

    const requests: Promise<void>[] = [];
    if (settings.tavilyKey.trim()) {
      requests.push(
        fetchTavilyUsage(settings.tavilyKey, controller.signal)
          .then(setTavily)
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              setTavily(null);
              setTavilyError(error instanceof Error ? error.message : String(error));
            }
          }),
      );
    } else {
      setTavily(null);
    }

    if (deepgramApiKey && settings.deepgramProjectId.trim()) {
      requests.push(
        fetchDeepgramDailyUsage(
          deepgramApiKey,
          settings.deepgramProjectId,
          7,
          controller.signal,
        )
          .then(setDeepgramDays)
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              setDeepgramDays(null);
              setDeepgramUsageError(error instanceof Error ? error.message : String(error));
            }
          }),
      );
      requests.push(
        fetchDeepgramBalances(
          deepgramApiKey,
          settings.deepgramProjectId,
          controller.signal,
        )
          .then(setDeepgramBalances)
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              setDeepgramBalances(null);
              setDeepgramBalanceError(error instanceof Error ? error.message : String(error));
            }
          }),
      );
    } else {
      setDeepgramDays(null);
      setDeepgramBalances(null);
    }

    await Promise.all(requests);
    if (!controller.signal.aborted) {
      setUpdatedAt(new Date());
      setLoading(false);
    }
  }, [deepgramApiKey, settings.deepgramProjectId, settings.tavilyKey]);

  useEffect(() => {
    void refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  const tavilyLimit = tavily?.key.limit ?? tavily?.account.planLimit ?? null;
  const tavilyUsage = tavily?.key.limit != null ? tavily.key.usage : tavily?.account.planUsage ?? 0;
  const planRemaining = tavily?.account.planLimit == null
    ? null
    : Math.max(0, tavily.account.planLimit - tavily.account.planUsage);
  const paygoRemaining = tavily?.account.paygoLimit == null
    ? null
    : Math.max(0, tavily.account.paygoLimit - tavily.account.paygoUsage);
  const tavilyRemaining = tavily?.key.limit != null
    ? Math.max(0, tavily.key.limit - tavily.key.usage)
    : planRemaining == null
      ? null
      : planRemaining + (paygoRemaining ?? 0);
  const totalHours = deepgramDays?.reduce((total, day) => total + day.hours, 0) ?? 0;
  const chartDays = sevenDayUsage(deepgramDays);
  const maxHours = Math.max(0.01, ...chartDays.map((day) => day.hours));
  const balanceUnits = new Set(deepgramBalances?.map((balance) => balance.units) ?? []);
  const totalBalance = deepgramBalances?.length && balanceUnits.size === 1
    ? deepgramBalances.reduce((sum, balance) => sum + balance.amount, 0)
    : null;
  const balanceValue = deepgramBalances === null
    ? "Unavailable"
    : deepgramBalances.length === 0
      ? "None"
      : totalBalance == null
        ? `${deepgramBalances.length} balances`
        : `${totalBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${deepgramBalances[0].units}`;

  return (
    <section className="flex-1 min-w-0 overflow-y-auto bg-bg/50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Gauge size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-ink">Usage &amp; Credits</h1>
            <p className="text-xs text-muted">Provider balances and recent API activity</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="hidden text-xs text-muted sm:inline">
              Updated {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex h-9 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-ink transition-colors hover:bg-bg disabled:opacity-60"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Search size={17} className="text-accent" />
              <h2 className="font-semibold text-ink">Tavily Search</h2>
            </div>
            {tavily && (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                {tavily.account.currentPlan}
              </span>
            )}
          </div>

          {tavily ? (
            <div className="mt-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Credits used"
                  value={formatNumber(tavilyUsage)}
                  detail={tavilyLimit == null ? "This billing cycle" : `of ${formatNumber(tavilyLimit)} credits`}
                  icon={Activity}
                />
                <StatCard
                  label="Credits remaining"
                  value={tavilyRemaining == null ? "No limit" : formatNumber(tavilyRemaining)}
                  detail={
                    tavilyRemaining == null
                      ? "No key or plan limit reported"
                      : tavily?.key.limit != null
                        ? "Estimated from current key usage"
                        : paygoRemaining != null
                          ? `${formatNumber(planRemaining ?? 0)} plan · ${formatNumber(paygoRemaining)} pay-as-you-go`
                          : "Estimated from current plan usage"
                  }
                  icon={Gauge}
                />
                <StatCard
                  label="Pay-as-you-go"
                  value={paygoRemaining == null ? "—" : formatNumber(paygoRemaining)}
                  detail={paygoRemaining == null ? "No separate allowance reported" : `of ${formatNumber(tavily.account.paygoLimit ?? 0)} credits left`}
                  icon={Search}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Search", tavily.key.searchUsage],
                  ["Extract", tavily.key.extractUsage],
                  ["Crawl", tavily.key.crawlUsage],
                  ["Map", tavily.key.mapUsage],
                  ["Research", tavily.key.researchUsage],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-bg px-3 py-2">
                    <p className="text-[11px] text-muted">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-ink">{formatNumber(Number(value))}</p>
                  </div>
                ))}
              </div>
              {tavilyLimit != null && (
                <div className="mt-5">
                  <div className="mb-2 flex justify-between text-xs text-muted">
                    <span>Key credit limit</span>
                    <span>{formatNumber(tavilyUsage)} / {formatNumber(tavilyLimit)}</span>
                  </div>
                  <UsageBar value={tavilyUsage} limit={tavilyLimit} />
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-bg px-4 py-5 text-sm text-muted">
              {tavilyError ? (
                <ProviderError message={tavilyError} />
              ) : loading ? (
                <span>Checking current-cycle usage...</span>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <span>Add a Tavily API key to see current-cycle usage and credits.</span>
                  <button onClick={onOpenSettings} className="shrink-0 text-accent hover:underline">
                    Open Settings
                  </button>
                </div>
              )}
            </div>
          )}
          {tavilyError && tavily && <ProviderError message={tavilyError} />}
        </section>

        <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AudioLines size={17} className="text-accent" />
              <h2 className="font-semibold text-ink">Deepgram Voice</h2>
            </div>
            {(deepgramDays || deepgramBalances) && (
              <span className="rounded-full bg-bg px-2.5 py-1 text-xs text-muted">
                Last 7 days
              </span>
            )}
          </div>

          {deepgramDays || deepgramBalances ? (
            <>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <StatCard
                  label="Audio processed"
                  value={`${formatHours(totalHours)} hrs`}
                  detail="Total speech processing in the last 7 days"
                  icon={AudioLines}
                />
                <StatCard
                  label="Available balance"
                  value={balanceValue}
                  detail={deepgramBalances?.length ? "Outstanding project balance" : "Current project balance"}
                  icon={Gauge}
                />
              </div>
              {deepgramBalances && deepgramBalances.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {deepgramBalances.map((balance, index) => (
                    <div key={balance.id || index} className="rounded-xl bg-bg p-4">
                      <p className="text-xs text-muted">
                        {balance.purchaseOrderId || `Balance ${index + 1}`}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-ink">
                        {balance.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {balance.units}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {deepgramUsageError && <ProviderError message={deepgramUsageError} />}
              {deepgramBalanceError && <ProviderError message={deepgramBalanceError} />}
              <div className="mt-5 rounded-xl border border-line bg-panel p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-ink">Daily speech usage</h3>
                    <p className="mt-0.5 text-xs text-muted">Audio hours processed per day</p>
                  </div>
                  <span className="text-xs text-muted">
                    {formatNumber(deepgramDays?.reduce((sum, day) => sum + day.requests, 0) ?? 0)} requests
                  </span>
                </div>
                {deepgramUsageError ? (
                  <p className="py-8 text-center text-sm text-muted">Usage chart unavailable. Check the access message above.</p>
                ) : (
                  <div className="grid grid-cols-7 gap-2">
                    {chartDays.map((day) => (
                      <div key={day.date} className="flex min-w-0 flex-col items-center gap-2">
                        <span className="h-4 text-[10px] text-muted">
                          {day.hours > 0 ? formatHours(day.hours) : "\u00a0"}
                        </span>
                        <div className="flex h-24 w-full items-end overflow-hidden rounded-md bg-bg">
                          <div
                            className={`w-full rounded-t-md transition-[height] ${day.hours > 0 ? "bg-accent" : "bg-line"}`}
                            style={{ height: `${day.hours > 0 ? Math.max(6, (day.hours / maxHours) * 100) : 3}%` }}
                            title={`${day.date}: ${formatHours(day.hours)} audio hours, ${formatNumber(day.requests)} requests`}
                          />
                        </div>
                        <span className="text-[10px] text-muted">{shortDate(day.date)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-xl bg-bg px-4 py-5 text-sm text-muted">
              {deepgramUsageError || deepgramBalanceError ? (
                <ProviderError message={[deepgramUsageError, deepgramBalanceError].filter(Boolean).join(" ")} />
              ) : loading ? (
                <span>Checking project usage and balances...</span>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <span>
                    {deepgramApiKey
                      ? "Add your Deepgram project ID and a management key with usage:read and billing:read in Settings under Voice Listening."
                      : "Add your Deepgram voice API key, management key, and project ID in Settings under Voice Listening. The management key needs usage:read and billing:read permissions."}
                  </span>
                  <button onClick={onOpenSettings} className="shrink-0 text-accent hover:underline">
                    <Settings2 size={15} className="inline" /> Settings
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            Usage and balances are fetched directly from Deepgram. A separate management key is recommended and your voice-recognition key remains unchanged.
          </p>
        </section>
      </div>
    </section>
  );
}
