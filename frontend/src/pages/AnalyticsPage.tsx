import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchDashboardStats, fetchLogs, fetchReportedLogs } from '@/lib/api';
import { VerificationStatus } from '@/lib/types';
import { formatTimestamp } from '@/lib/hashUtils';

const STATUS_COLOR_MAP: Record<string, string> = {
  Verified: '#22c55e',
  Pending: '#f59e0b',
  Unverified: '#000000',
  Tampered: '#ef4444',
};

const STATUS_ORDER = ['Verified', 'Pending', 'Unverified', 'Tampered'];
type RiskFlag = 'normal' | 'suspicious' | 'fraud';
const FLAG_STORAGE_KEY = 'log_guardian_risk_flags';
const STATUS_OVERRIDE_STORAGE_KEY = 'log_guardian_status_overrides';

const AnalyticsPage = () => {
  const [riskFlags, setRiskFlags] = useState<Record<string, RiskFlag>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, VerificationStatus>>({});

  useEffect(() => {
    const loadLocalState = () => {
      try {
        const rawFlags = localStorage.getItem(FLAG_STORAGE_KEY);
        const rawOverrides = localStorage.getItem(STATUS_OVERRIDE_STORAGE_KEY);
        setRiskFlags(rawFlags ? (JSON.parse(rawFlags) as Record<string, RiskFlag>) : {});
        setStatusOverrides(rawOverrides ? (JSON.parse(rawOverrides) as Record<string, VerificationStatus>) : {});
      } catch {
        setRiskFlags({});
        setStatusOverrides({});
      }
    };

    loadLocalState();
    window.addEventListener('storage', loadLocalState);
    return () => window.removeEventListener('storage', loadLocalState);
  }, []);

  const statsQuery = useQuery({
    queryKey: ['analytics-stats'],
    queryFn: fetchDashboardStats,
    retry: 1,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });
  const logsQuery = useQuery({
    queryKey: ['analytics-logs'],
    queryFn: () => fetchLogs({ page: 1, pageSize: 300, status: 'all' }),
    retry: 1,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });
  const reportedLogsQuery = useQuery({
    queryKey: ['analytics-reported-logs'],
    queryFn: () => fetchReportedLogs({ page: 1, pageSize: 100 }),
    retry: 1,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  const getEffectiveStatus = (log: { id: string; status: VerificationStatus }): VerificationStatus => {
    const flag = riskFlags[log.id] ?? 'normal';
    if (flag === 'suspicious') return 'unverified';
    if (flag === 'fraud') return 'tampered';
    if (statusOverrides[log.id]) return statusOverrides[log.id];
    return log.status;
  };

  const resilientStats = useMemo(() => {
    const backend = statsQuery.data;
    const items = logsQuery.data?.items ?? [];
    const totalFromLogsApi = logsQuery.data?.total ?? items.length;
    const verified = items.filter((log) => getEffectiveStatus(log) === 'verified').length;
    const tampered = items.filter((log) => getEffectiveStatus(log) === 'tampered').length;
    const storageBytes = items.reduce((sum, log) => sum + (Number(log.fileSize) || 0), 0);
    const totalStorage = storageBytes < 1024
      ? `${storageBytes} B`
      : storageBytes < 1024 * 1024
        ? `${(storageBytes / 1024).toFixed(1)} KB`
        : `${(storageBytes / (1024 * 1024)).toFixed(1)} MB`;

    if (
      backend &&
      !(backend.networkStatus === 'disconnected' && backend.totalLogs === 0 && totalFromLogsApi > 0)
    ) {
      return backend;
    }

    return {
      totalLogs: totalFromLogsApi,
      verifiedLogs: verified,
      tamperedLogs: tampered,
      activeDevices: new Set(items.map((log) => log.deviceId)).size,
      totalStorage,
      networkStatus: totalFromLogsApi > 0 ? 'connected' : 'disconnected',
    };
  }, [statsQuery.data, logsQuery.data?.items, logsQuery.data?.total, riskFlags, statusOverrides]);

  const flagSummary = useMemo(() => {
    const items = logsQuery.data?.items ?? [];
    let suspicious = 0;
    let fraud = 0;

    for (const log of items) {
      const flag = riskFlags[log.id] ?? 'normal';
      if (flag === 'suspicious') suspicious += 1;
      if (flag === 'fraud') fraud += 1;
    }

    return { suspicious, fraud };
  }, [logsQuery.data?.items, riskFlags]);

  const deviceChart = useMemo(() => {
    if (!logsQuery.data?.items) return [];
    const map = new Map<string, number>();
    for (const log of logsQuery.data.items) {
      const deviceId = log.deviceId || 'Unknown';
      map.set(deviceId, (map.get(deviceId) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([device, count]) => ({ device: device.substring(0, 12), count }));
  }, [logsQuery.data?.items]);

  const statusChart = useMemo(() => {
    if (!logsQuery.data?.items) return [];
    const map = new Map<string, number>();
    for (const log of logsQuery.data.items) {
      const status =
        getEffectiveStatus(log) === 'verified'
          ? 'Verified'
          : getEffectiveStatus(log) === 'pending'
            ? 'Pending'
            : getEffectiveStatus(log) === 'unverified'
              ? 'Unverified'
              : 'Tampered';
      map.set(status, (map.get(status) ?? 0) + 1);
    }

    return STATUS_ORDER
      .map((name) => ({ name, value: map.get(name) ?? 0 }))
      .filter((entry) => entry.value > 0);
  }, [logsQuery.data?.items, riskFlags, statusOverrides]);

  if (statsQuery.isLoading || logsQuery.isLoading) {
    return (
      <div className="space-y-6 max-w-7xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Live distribution of logs across devices and integrity states.</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 text-center text-muted-foreground animate-pulse h-96">
          <p className="text-sm">Loading analytics data...</p>
        </div>
      </div>
    );
  }

  if (statsQuery.isError) {
    return (
      <div className="space-y-6 max-w-7xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Live distribution of logs across devices and integrity states.</p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Unable to load analytics. Backend may be unavailable.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Live distribution of logs across devices and integrity states.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Logs</p>
          <p className="text-2xl font-bold mt-1">{resilientStats.totalLogs ?? '-'}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Verified</p>
          <p className="text-2xl font-bold mt-1 text-primary">{resilientStats.verifiedLogs ?? '-'}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Tampered</p>
          <p className="text-2xl font-bold mt-1 text-destructive">{resilientStats.tamperedLogs ?? '-'}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Storage</p>
          <p className="text-2xl font-bold mt-1">{resilientStats.totalStorage ?? '-'}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Flag: Suspicious</p>
          <p className="text-2xl font-bold mt-1 text-amber-600">{flagSummary.suspicious}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Flag: Fraud</p>
          <p className="text-2xl font-bold mt-1 text-destructive">{flagSummary.fraud}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">Logs by Device</h2>
          {deviceChart.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deviceChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="device" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#22c55e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center text-muted-foreground">
              <p className="text-sm">No device data available</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">Verification Status Mix</h2>
          {statusChart.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusChart} dataKey="value" nameKey="name" outerRadius={100} label>
                    {statusChart.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLOR_MAP[entry.name] ?? '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 flex items-center justify-center text-muted-foreground">
              <p className="text-sm">No status data available</p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold mb-3">Reported Logs</h2>
        {reportedLogsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground py-4">Loading reported logs...</div>
        ) : reportedLogsQuery.isError ? (
          <div className="text-sm text-destructive py-4">Unable to load reported logs.</div>
        ) : (reportedLogsQuery.data?.items.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground py-4">No reported logs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Log ID</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Device</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Flag</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reason</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reported By</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                {reportedLogsQuery.data?.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/50">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.logId}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.deviceId}</td>
                    <td className="px-3 py-2">
                      <span className={item.reportFlag === 'fraud' ? 'text-destructive font-medium' : 'text-amber-600 font-medium'}>
                        {item.reportFlag}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{item.reportReason || '-'}</td>
                    <td className="px-3 py-2 capitalize">{item.status}</td>
                    <td className="px-3 py-2 font-mono text-xs">{item.reportedByWallet}</td>
                    <td className="px-3 py-2 capitalize">{item.reportedByRole}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatTimestamp(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsPage;
