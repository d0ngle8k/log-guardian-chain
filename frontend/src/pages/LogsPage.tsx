import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, ChevronLeft, ChevronRight, ExternalLink, Eye, RefreshCw, ShieldCheck, Flag } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { VerificationModal } from '@/components/logs/VerificationModal.tsx';
import { truncateHash, formatFileSize, formatTimestamp } from '@/lib/hashUtils';
import { LogEntry, VerificationStatus } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { fetchLogs, getAuthSession, reportLog, verifyLog } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE = 15;
type RiskFlag = 'normal' | 'suspicious' | 'fraud';
const FLAG_STORAGE_KEY = 'log_guardian_risk_flags';
const STATUS_OVERRIDE_STORAGE_KEY = 'log_guardian_status_overrides';
const VERIFIED_ONCE_STORAGE_KEY = 'log_guardian_verified_once';

const LogsPage = () => {
  const [search, setSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [riskFlags, setRiskFlags] = useState<Record<string, RiskFlag>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, VerificationStatus>>({});
  const [verifiedOnce, setVerifiedOnce] = useState<Record<string, boolean>>({});
  const [isVerifyingAll, setIsVerifyingAll] = useState(false);
  const [isVerifyingSelected, setIsVerifyingSelected] = useState(false);
  const [isReportingSelected, setIsReportingSelected] = useState(false);
  const [verifyingLogId, setVerifyingLogId] = useState<string | null>(null);
  const [reportingLogId, setReportingLogId] = useState<string | null>(null);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  const session = getAuthSession();
  const isAdmin = session.role === 'admin';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FLAG_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, RiskFlag>;
      setRiskFlags(parsed);
    } catch {
      setRiskFlags({});
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(FLAG_STORAGE_KEY, JSON.stringify(riskFlags));
  }, [riskFlags]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STATUS_OVERRIDE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, VerificationStatus>;
      setStatusOverrides(parsed);
    } catch {
      setStatusOverrides({});
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STATUS_OVERRIDE_STORAGE_KEY, JSON.stringify(statusOverrides));
  }, [statusOverrides]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VERIFIED_ONCE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      setVerifiedOnce(parsed);
    } catch {
      setVerifiedOnce({});
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(VERIFIED_ONCE_STORAGE_KEY, JSON.stringify(verifiedOnce));
  }, [verifiedOnce]);

  const statusQueryFilter =
    statusFilter === 'unverified' || statusFilter === 'tampered' ? 'all' : statusFilter;

  const logsQuery = useQuery({
    queryKey: ['logs', search, formatFilter, statusFilter, page, statusQueryFilter],
    queryFn: () =>
      fetchLogs({
        page,
        pageSize: PAGE_SIZE,
        search,
        format: formatFilter,
        status: statusQueryFilter,
      }),
    retry: 1,
  });

  const paged = logsQuery.data?.items ?? [];
  const total = logsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const setFlag = (logId: string, value: RiskFlag) => {
    if (verifiedOnce[logId]) {
      return;
    }
    setRiskFlags((prev) => ({ ...prev, [logId]: value }));
  };

  const getEffectiveStatus = (log: LogEntry): VerificationStatus => {
    const flag = riskFlags[log.id] ?? 'normal';
    if (flag === 'suspicious') return 'unverified';
    if (flag === 'fraud') return 'tampered';
    if (statusOverrides[log.id]) return statusOverrides[log.id];
    return log.status;
  };

  const displayedLogs = paged.filter((log) => {
    if (statusFilter === 'all') {
      return true;
    }
    return getEffectiveStatus(log) === statusFilter;
  });

  const selectableLogs = displayedLogs.filter((log) => {
    const status = getEffectiveStatus(log);
    return (status === 'unverified' || status === 'tampered') && !verifiedOnce[log.id];
  });

  useEffect(() => {
    // Keep only currently eligible selections.
    const visibleIds = new Set(selectableLogs.map((log) => log.id));
    setSelectedLogIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visibleIds.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  }, [selectableLogs]);

  const toggleSelectLog = (logId: string, checked: boolean) => {
    setSelectedLogIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(logId);
      } else {
        next.delete(logId);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedLogIds(() => {
      if (!checked) {
        return new Set();
      }
      return new Set(selectableLogs.map((log) => log.id));
    });
  };

  const selectedLogs = selectableLogs.filter((log) => selectedLogIds.has(log.id));
  const allVisibleSelected = selectableLogs.length > 0 && selectedLogs.length === selectableLogs.length;

  const verifySingleLog = async (log: LogEntry) => {
    if (verifiedOnce[log.id]) {
      return;
    }

    setVerifyingLogId(log.id);
    setVerifyMessage(null);

    try {
      const flag = riskFlags[log.id] ?? 'normal';

      if (flag === 'suspicious') {
        setStatusOverrides((prev) => ({ ...prev, [log.id]: 'unverified' }));
        setVerifiedOnce((prev) => ({ ...prev, [log.id]: true }));
        setVerifyMessage(`Log ${log.id} flagged suspicious -> status set to unverified.`);
        return;
      }

      if (flag === 'fraud') {
        setStatusOverrides((prev) => ({ ...prev, [log.id]: 'tampered' }));
        setVerifiedOnce((prev) => ({ ...prev, [log.id]: true }));
        setVerifyMessage(`Log ${log.id} flagged fraud -> status set to tampered.`);
        return;
      }

      const result = await verifyLog(log.id);
      setStatusOverrides((prev) => ({
        ...prev,
        [log.id]: result.verified ? 'verified' : 'tampered',
      }));
      setVerifiedOnce((prev) => ({ ...prev, [log.id]: true }));
      setVerifyMessage(
        result.verified
          ? `Log ${log.id} verified successfully.`
          : `Log ${log.id} verification result: tampered.`,
      );
      await logsQuery.refetch();
    } catch (error) {
      setVerifyMessage(`Verify failed for ${log.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setVerifyingLogId(null);
    }
  };

  const reportSingleLog = async (log: LogEntry) => {
    if (verifiedOnce[log.id]) {
      return;
    }

    const flag = riskFlags[log.id] ?? 'normal';
    if (flag === 'normal') {
      return;
    }

    setReportingLogId(log.id);
    setVerifyMessage(null);

    try {
      const result = await reportLog({
        logId: log.id,
        reportFlag: flag,
      });

      setStatusOverrides((prev) => ({
        ...prev,
        [log.id]: result.status as VerificationStatus,
      }));
      setVerifiedOnce((prev) => ({ ...prev, [log.id]: true }));
      setVerifyMessage(
        `Report submitted for ${result.logId} by ${result.reportedByWallet} (${result.reportedByRole}).`,
      );
      await logsQuery.refetch();
    } catch (error) {
      setVerifyMessage(`Report failed for ${log.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setReportingLogId(null);
    }
  };

  const verifyAllLogs = async () => {
    setIsVerifyingAll(true);
    setVerifyMessage(null);

    try {
      const firstPage = await fetchLogs({
        page: 1,
        pageSize: 100,
        search,
        format: formatFilter,
        status: statusQueryFilter,
      });

      let allLogs = [...firstPage.items];
      const allPages = Math.max(1, Math.ceil(firstPage.total / 100));

      for (let p = 2; p <= allPages; p += 1) {
        const next = await fetchLogs({
          page: p,
          pageSize: 100,
          search,
          format: formatFilter,
          status: statusQueryFilter,
        });
        allLogs = allLogs.concat(next.items);
      }

      if (allLogs.length === 0) {
        setVerifyMessage('No logs available to verify with current filters.');
        return;
      }

      let verifiedCount = 0;
      let tamperedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let suspiciousAppliedCount = 0;
      let fraudAppliedCount = 0;
      const nextOverrides: Record<string, VerificationStatus> = {};
      const nextVerifiedOnce: Record<string, boolean> = {};

      for (const log of allLogs) {
        if (verifiedOnce[log.id]) {
          skippedCount += 1;
          continue;
        }

        const flag = riskFlags[log.id] ?? 'normal';

        if (flag === 'suspicious') {
          nextOverrides[log.id] = 'unverified';
          nextVerifiedOnce[log.id] = true;
          suspiciousAppliedCount += 1;
          continue;
        }

        if (flag === 'fraud') {
          nextOverrides[log.id] = 'tampered';
          nextVerifiedOnce[log.id] = true;
          fraudAppliedCount += 1;
          continue;
        }

        try {
          const result = await verifyLog(log.id);
          if (result.verified) {
            verifiedCount += 1;
            nextOverrides[log.id] = 'verified';
            nextVerifiedOnce[log.id] = true;
          } else {
            tamperedCount += 1;
            nextOverrides[log.id] = 'tampered';
            nextVerifiedOnce[log.id] = true;
          }
        } catch {
          failedCount += 1;
        }
      }

      setStatusOverrides((prev) => ({
        ...prev,
        ...nextOverrides,
      }));
      setVerifiedOnce((prev) => ({
        ...prev,
        ...nextVerifiedOnce,
      }));

      setVerifyMessage(
        `Verify all done: ${verifiedCount} verified, ${tamperedCount} tampered, ${suspiciousAppliedCount} suspicious -> unverified, ${fraudAppliedCount} fraud -> tampered, ${skippedCount} skipped (already verified), ${failedCount} failed.`,
      );
      await logsQuery.refetch();
    } catch (error) {
      setVerifyMessage(`Verify all failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsVerifyingAll(false);
    }
  };

  const verifySelectedLogs = async () => {
    if (selectedLogs.length === 0) {
      setVerifyMessage('Select at least one log to verify.');
      return;
    }

    setIsVerifyingSelected(true);
    setVerifyMessage(null);

    try {
      let verifiedCount = 0;
      let tamperedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const nextOverrides: Record<string, VerificationStatus> = {};
      const nextVerifiedOnce: Record<string, boolean> = {};

      for (const log of selectedLogs) {
        if (verifiedOnce[log.id]) {
          skippedCount += 1;
          continue;
        }

        const flag = riskFlags[log.id] ?? 'normal';
        if (flag !== 'normal') {
          skippedCount += 1;
          continue;
        }

        try {
          const result = await verifyLog(log.id);
          if (result.verified) {
            verifiedCount += 1;
            nextOverrides[log.id] = 'verified';
          } else {
            tamperedCount += 1;
            nextOverrides[log.id] = 'tampered';
          }
          nextVerifiedOnce[log.id] = true;
        } catch {
          failedCount += 1;
        }
      }

      setStatusOverrides((prev) => ({ ...prev, ...nextOverrides }));
      setVerifiedOnce((prev) => ({ ...prev, ...nextVerifiedOnce }));
      setSelectedLogIds(new Set());
      setVerifyMessage(
        `Verify selected done: ${verifiedCount} verified, ${tamperedCount} tampered, ${skippedCount} skipped, ${failedCount} failed.`,
      );
      await logsQuery.refetch();
    } catch (error) {
      setVerifyMessage(`Verify selected failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsVerifyingSelected(false);
    }
  };

  const reportSelectedLogs = async () => {
    if (selectedLogs.length === 0) {
      setVerifyMessage('Select at least one log to report.');
      return;
    }

    setIsReportingSelected(true);
    setVerifyMessage(null);

    try {
      let reportedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      const nextOverrides: Record<string, VerificationStatus> = {};
      const nextVerifiedOnce: Record<string, boolean> = {};

      for (const log of selectedLogs) {
        if (verifiedOnce[log.id]) {
          skippedCount += 1;
          continue;
        }

        const flag = riskFlags[log.id] ?? 'normal';
        if (flag === 'normal') {
          skippedCount += 1;
          continue;
        }

        try {
          const result = await reportLog({
            logId: log.id,
            reportFlag: flag,
          });
          nextOverrides[log.id] = result.status as VerificationStatus;
          nextVerifiedOnce[log.id] = true;
          reportedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      setStatusOverrides((prev) => ({ ...prev, ...nextOverrides }));
      setVerifiedOnce((prev) => ({ ...prev, ...nextVerifiedOnce }));
      setSelectedLogIds(new Set());
      setVerifyMessage(`Report selected done: ${reportedCount} reported, ${skippedCount} skipped, ${failedCount} failed.`);
      await logsQuery.refetch();
    } catch (error) {
      setVerifyMessage(`Report selected failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsReportingSelected(false);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold text-foreground">Log Explorer</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse and verify blockchain-stored log entries</p>
        {logsQuery.isError && (
          <p className="text-xs text-destructive mt-2">Unable to load backend logs. Check backend service status.</p>
        )}
        {verifyMessage && <p className="text-xs text-muted-foreground mt-2">{verifyMessage}</p>}
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex w-full flex-wrap gap-3"
      >
        <div className="relative w-full sm:min-w-[260px] sm:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by device ID, CID, or log ID..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 bg-card border-border"
          />
        </div>
        <Select value={formatFilter} onValueChange={(v) => { setFormatFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[150px] bg-card border-border">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Formats</SelectItem>
            {['JSON', 'Plain Text', 'XML', 'CSV', 'Syslog', 'GELF', 'CEF'].map(f => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[150px] bg-card border-border">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="tampered">Tampered</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => logsQuery.refetch()}
          disabled={logsQuery.isFetching}
          className="w-full sm:w-auto gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${logsQuery.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button onClick={verifyAllLogs} disabled={isVerifyingAll || logsQuery.isFetching} className="w-full sm:w-auto gap-2">
          <ShieldCheck className="w-4 h-4" />
          {isVerifyingAll ? 'Verifying All...' : 'Verify All Logs'}
        </Button>
        {isAdmin && (
          <>
            <Button
              variant="outline"
              onClick={verifySelectedLogs}
              disabled={selectedLogs.length === 0 || isVerifyingSelected || logsQuery.isFetching}
              className="w-full sm:w-auto gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              {isVerifyingSelected ? 'Verifying Selected...' : `Verify Selected (${selectedLogs.length})`}
            </Button>
            <Button
              variant="outline"
              onClick={reportSelectedLogs}
              disabled={selectedLogs.length === 0 || isReportingSelected || logsQuery.isFetching}
              className="w-full sm:w-auto gap-2"
            >
              <Flag className="w-4 h-4" />
              {isReportingSelected ? 'Reporting Selected...' : `Report Selected (${selectedLogs.length})`}
            </Button>
          </>
        )}
      </motion.div>
      {isAdmin && (
        <p className="text-xs text-muted-foreground">
          Bulk rules: Only unverified/tampered logs are selectable; verified logs are locked and cannot be ticked.
        </p>
      )}

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-xl border border-border bg-card overflow-hidden"
      >
        <div className="w-full overflow-x-auto scrollbar-thin">
          <table className="min-w-[1180px] w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {isAdmin && (
                  <th className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      disabled={selectableLogs.length === 0}
                      onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                      aria-label="Select all eligible logs"
                    />
                  </th>
                )}
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">ID</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Device</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Format</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">IPFS CID</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Hash</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Size</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Flag</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {logsQuery.isLoading && (
                <tr>
                  <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={isAdmin ? 11 : 10}>Loading logs...</td>
                </tr>
              )}
              {!logsQuery.isLoading && displayedLogs.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={isAdmin ? 11 : 10}>No logs found.</td>
                </tr>
              )}
              {displayedLogs.map((log, i) => (
                (() => {
                  const currentFlag = riskFlags[log.id] ?? 'normal';
                  const effectiveStatus = getEffectiveStatus(log);
                  const isLocked = Boolean(verifiedOnce[log.id]);
                  const canVerify = !isLocked && currentFlag === 'normal' && effectiveStatus === 'pending';
                  const canReport = !isLocked && currentFlag !== 'normal';

                  return (
                <motion.tr
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className={cn(
                    'border-b border-border/50 transition-colors',
                    currentFlag === 'normal' && 'hover:bg-muted/20',
                    currentFlag === 'suspicious' && 'bg-warning/10 hover:bg-warning/20',
                    currentFlag === 'fraud' && 'bg-destructive/10 hover:bg-destructive/20',
                  )}
                >
                  {isAdmin && (
                    <td className="px-3 py-3 text-center align-middle">
                      {(() => {
                        const isSelectable = (effectiveStatus === 'unverified' || effectiveStatus === 'tampered') && !isLocked;
                        return (
                      <input
                        type="checkbox"
                        checked={selectedLogIds.has(log.id)}
                        disabled={!isSelectable}
                        onChange={(e) => toggleSelectLog(log.id, e.target.checked)}
                        aria-label={`Select log ${log.id}`}
                        title={
                          isSelectable
                            ? 'Select for bulk action'
                            : 'Only unverified/tampered and not-yet-verified logs are selectable'
                        }
                      />
                        );
                      })()}
                    </td>
                  )}
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{log.id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{log.deviceId}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{log.format}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-accent">{truncateHash(log.ipfsCid, 6)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{truncateHash(log.hashOnChain, 6)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatFileSize(log.fileSize)}</td>
                  <td className="px-4 py-3"><StatusBadge status={effectiveStatus} /></td>
                  <td className="px-4 py-3">
                    <select
                      className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground"
                      value={currentFlag}
                      onChange={(e) => setFlag(log.id, e.target.value as RiskFlag)}
                      disabled={isLocked}
                      aria-label={`Set risk flag for ${log.id}`}
                    >
                      <option value="normal">normal</option>
                      <option value="suspicious">suspicious</option>
                      <option value="fraud">fraud</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {currentFlag === 'normal' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={!canVerify || verifyingLogId === log.id}
                          onClick={() => void verifySingleLog(log)}
                        >
                          {verifyingLogId === log.id ? 'Verifying...' : isLocked ? 'Verified' : 'Verify'}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!canReport || reportingLogId === log.id}
                        onClick={() => void reportSingleLog(log)}
                      >
                        <Flag className="w-3 h-3 mr-1" />
                        {reportingLogId === log.id ? 'Reporting...' : 'Report'}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedLog(log)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {log.txSignature && log.txSignature !== 'PENDING' ? (
                        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                          <a
                            href={`https://explorer.solana.com/tx/${log.txSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`View transaction ${log.txSignature} in Solana Explorer`}
                            title="Open in Solana Explorer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled title={log.txSignature === 'PENDING' ? 'Transaction pending' : 'No transaction'}>
                          <ExternalLink className="w-3.5 h-3.5 opacity-50" />
                        </Button>
                      )}
                    </div>
                  </td>
                </motion.tr>
                  );
                })()
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="grid grid-cols-1 gap-2 px-4 py-3 border-t border-border md:grid-cols-3 md:items-center">
          <p className="text-xs text-muted-foreground text-center md:text-left">
            {total === 0
              ? 'Showing 0 of 0'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">Page {page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="hidden md:block" />
        </div>
      </motion.div>

      {/* Verification Modal */}
      {selectedLog && (
        <VerificationModal
          log={selectedLog}
          allowVerify={false}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </div>
  );
};

export default LogsPage;
