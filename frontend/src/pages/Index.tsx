import { Database, ShieldCheck, AlertTriangle, Cpu, HardDrive, Wifi } from 'lucide-react';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { fetchActivity, fetchDashboardStats, fetchLogs } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { VerificationStatus } from '@/lib/types';

type RiskFlag = 'normal' | 'suspicious' | 'fraud';

const FLAG_STORAGE_KEY = 'log_guardian_risk_flags';
const STATUS_OVERRIDE_STORAGE_KEY = 'log_guardian_status_overrides';

interface DashboardViewStats {
  totalLogs: number;
  verifiedLogs: number;
  tamperedLogs: number;
  suspiciousLogs: number;
  activeDevices: number;
  totalStorage: string;
  networkStatus: 'connected' | 'degraded' | 'disconnected';
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [riskFlags, setRiskFlags] = useState<Record<string, RiskFlag>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, VerificationStatus>>({});
  const [showHowToUse, setShowHowToUse] = useState(false);

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
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    retry: 1,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  const activityQuery = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: fetchActivity,
    retry: 1,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  const logsSnapshotQuery = useQuery({
    queryKey: ['dashboard-logs-snapshot'],
    queryFn: () => fetchLogs({ page: 1, pageSize: 500, status: 'all' }),
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

  // Default stats with 0 values
  const defaultStats: DashboardViewStats = {
    totalLogs: 0,
    verifiedLogs: 0,
    tamperedLogs: 0,
    suspiciousLogs: 0,
    activeDevices: 0,
    totalStorage: '0 B',
    networkStatus: 'disconnected',
  };

  const liveStats = useMemo<DashboardViewStats>(() => {
    const items = logsSnapshotQuery.data?.items ?? [];
    const totalFromApi = logsSnapshotQuery.data?.total ?? items.length;
    const verified = items.filter((log) => getEffectiveStatus(log) === 'verified').length;
    const tampered = items.filter((log) => getEffectiveStatus(log) === 'tampered').length;
    const suspicious = items.filter((log) => (riskFlags[log.id] ?? 'normal') === 'suspicious').length;
    const devices = new Set(items.map((log) => log.deviceId)).size;
    const storageBytes = items.reduce((sum, log) => sum + (Number(log.fileSize) || 0), 0);
    const totalStorage = storageBytes < 1024
      ? `${storageBytes} B`
      : storageBytes < 1024 * 1024
        ? `${(storageBytes / 1024).toFixed(1)} KB`
        : `${(storageBytes / (1024 * 1024)).toFixed(1)} MB`;

    return {
      totalLogs: totalFromApi,
      verifiedLogs: verified,
      tamperedLogs: tampered,
      suspiciousLogs: suspicious,
      activeDevices: devices,
      totalStorage,
      networkStatus: totalFromApi > 0 ? 'connected' : 'disconnected',
    };
  }, [logsSnapshotQuery.data?.items, logsSnapshotQuery.data?.total, riskFlags, statusOverrides]);

  const backendStats = statsQuery.data;
  const stats: DashboardViewStats = useMemo(() => {
    const hasSnapshot = (logsSnapshotQuery.data?.total ?? 0) > 0;

    if (!backendStats && !hasSnapshot) {
      return defaultStats;
    }

    if (!backendStats && hasSnapshot) {
      return liveStats;
    }

    return {
      totalLogs: hasSnapshot ? liveStats.totalLogs : (backendStats?.totalLogs ?? 0),
      verifiedLogs: hasSnapshot ? liveStats.verifiedLogs : (backendStats?.verifiedLogs ?? 0),
      tamperedLogs: hasSnapshot ? liveStats.tamperedLogs : (backendStats?.tamperedLogs ?? 0),
      suspiciousLogs: liveStats.suspiciousLogs,
      activeDevices: hasSnapshot ? liveStats.activeDevices : (backendStats?.activeDevices ?? 0),
      totalStorage: hasSnapshot ? liveStats.totalStorage : (backendStats?.totalStorage ?? '0 B'),
      networkStatus: hasSnapshot
        ? liveStats.networkStatus
        : (backendStats?.networkStatus ?? 'disconnected'),
    };
  }, [backendStats, defaultStats, liveStats, logsSnapshotQuery.data?.total]);
  const activity = activityQuery.data;
  const isStatsLoadingOrError = statsQuery.isLoading || statsQuery.isError;
  
  // Format network status for display
  const networkStatusDisplay = stats.networkStatus === 'connected' 
    ? 'Solana Devnet Connected' 
    : 'Solana Devnet Disconnected';

  // Quick Actions handlers
  const handleVerifyLatestBatch = () => {
    navigate('/logs?action=verify');
  };

  const handleExportReport = () => {
    // Trigger CSV download
    const csvContent = 'device_id,log_hash,status,timestamp\n'; // Basic CSV header
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `verification-report-${new Date().toISOString()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleDeviceStatus = () => {
    navigate('/settings');
  };

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Blockchain log storage overview</p>
      </motion.div>

      {/* Stats Grid - Always Show */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4 transition-opacity ${isStatsLoadingOrError ? 'opacity-60' : ''}`}>
        <StatsCard title="Total Logs" value={stats.totalLogs} icon={Database} trend={isStatsLoadingOrError ? "Loading..." : "Registered on Solana"} variant="default" delay={0} />
        <StatsCard title="Verified" value={stats.verifiedLogs} icon={ShieldCheck} trend={isStatsLoadingOrError ? "Loading..." : "Verified Integrity"} variant="success" delay={0.05} />
        <StatsCard title="Tampered" value={stats.tamperedLogs} icon={AlertTriangle} trend={isStatsLoadingOrError ? "Loading..." : stats.tamperedLogs > 0 ? "Mismatches Found" : "No Issues"} variant="destructive" delay={0.1} />
        <StatsCard title="Suspicious" value={stats.suspiciousLogs} icon={AlertTriangle} trend={isStatsLoadingOrError ? "Loading..." : stats.suspiciousLogs > 0 ? "Needs Review" : "No Flags"} variant="warning" delay={0.15} />
        <StatsCard title="Devices" value={stats.activeDevices} icon={Cpu} trend={isStatsLoadingOrError ? "Loading..." : stats.activeDevices === 1 ? "Admin Connected" : "Connected"} variant="default" delay={0.2} />
        <StatsCard title="Storage" value={stats.totalStorage} icon={HardDrive} trend={isStatsLoadingOrError ? "Loading..." : "Verified Data"} variant="default" delay={0.25} />
        <StatsCard title="Network" value="Devnet" icon={Wifi} trend={isStatsLoadingOrError ? "Connecting..." : networkStatusDisplay} variant={stats.networkStatus === 'connected' ? "success" : "destructive"} delay={0.3} />
      </div>

      {/* Activity Feed - Loading/Error/Data */}
      {activityQuery.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-lg border border-border bg-card p-4 h-64 animate-pulse" />
          <div className="rounded-lg border border-border bg-card p-4 h-64 animate-pulse" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {activity && activity.length > 0 ? (
              <ActivityTimeline items={activity} />
            ) : (
              <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
                <p className="text-sm">No recent activity yet</p>
              </div>
            )}
          </div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="rounded-xl border border-border bg-card p-5"
          >
            <h3 className="text-sm font-semibold text-card-foreground mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <button
                onClick={handleVerifyLatestBatch}
                className="w-full text-left p-3 rounded-lg bg-secondary hover:bg-primary/10 hover:border-primary/20 border border-transparent transition-all group"
              >
                <p className="text-sm font-medium text-card-foreground group-hover:text-primary transition-colors">Verify Latest Batch</p>
                <p className="text-xs text-muted-foreground mt-0.5">Run integrity check on recent logs</p>
              </button>
              <button
                onClick={handleExportReport}
                className="w-full text-left p-3 rounded-lg bg-secondary hover:bg-primary/10 hover:border-primary/20 border border-transparent transition-all group"
              >
                <p className="text-sm font-medium text-card-foreground group-hover:text-primary transition-colors">Export Report</p>
                <p className="text-xs text-muted-foreground mt-0.5">Download verification report as CSV</p>
              </button>
              <button
                onClick={() => window.location.href = '/settings'}
                className="w-full text-left p-3 rounded-lg bg-secondary hover:bg-primary/10 hover:border-primary/20 border border-transparent transition-all group"
              >
                <p className="text-sm font-medium text-card-foreground group-hover:text-primary transition-colors">Settings</p>
                <p className="text-xs text-muted-foreground mt-0.5">Configure collectors and system settings</p>
              </button>
              <button
                onClick={() => setShowHowToUse((prev) => !prev)}
                className="w-full text-left p-3 rounded-lg bg-secondary hover:bg-primary/10 hover:border-primary/20 border border-transparent transition-all group"
              >
                <p className="text-sm font-medium text-card-foreground group-hover:text-primary transition-colors">How to Use</p>
                <p className="text-xs text-muted-foreground mt-0.5">English usage guide for the full website</p>
              </button>
            </div>
            {showHowToUse && (
              <div className="mt-3 rounded-lg border border-border/70 bg-secondary/30 p-3 text-xs text-muted-foreground space-y-1.5">
                <p className="font-medium text-card-foreground">Website Guide (English)</p>
                <p>1. Connect Wallet: Open the wallet button in the header and connect your Solana wallet to unlock role-based features.</p>
                <p>2. Dashboard: Monitor Total, Verified, Tampered, and Suspicious logs. Values auto-refresh every few seconds.</p>
                <p>3. Log Explorer: Search and filter logs, inspect details, verify integrity, and flag suspicious or fraud entries.</p>
                <p>4. Analytics: Track live status distribution, device trends, and review the Reported Logs table for audit actions.</p>
                <p>5. Settings: Manage collector and system configuration, then re-check Dashboard and Analytics for updated telemetry.</p>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
