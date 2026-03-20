import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AdminAuditLog,
  AdminKpis,
  AdminRetryJob,
  fetchAdminAuditLog,
  fetchAdminKpis,
  fetchAdminRetryJobs,
  getAuthSession,
  grantWalletRole,
  ingestLog,
  listWalletRoles,
  retryAdminJobNow,
  revokeWalletRole,
  WalletRoleRecord,
} from '@/lib/api';
import { AdminSupportChat } from '@/components/support/AdminSupportChat';
import { formatTimestamp, truncateAddress } from '@/lib/hashUtils';

const SettingsPage = () => {
  const programId = import.meta.env.VITE_SOLANA_PROGRAM_ID ?? 'not-configured';
  const [deviceId, setDeviceId] = useState('sensor-alpha-01');
  const [format, setFormat] = useState('JSON');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [assignWallet, setAssignWallet] = useState('');
  const [assignRole, setAssignRole] = useState<'employee' | 'manager'>('employee');
  const [roleRows, setRoleRows] = useState<WalletRoleRecord[]>([]);
  const [roleStatus, setRoleStatus] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [retryStatusFilter, setRetryStatusFilter] = useState<'pending' | 'running' | 'completed' | 'failed' | 'abandoned'>('pending');
  const [retryJobs, setRetryJobs] = useState<AdminRetryJob[]>([]);
  const [kpis, setKpis] = useState<AdminKpis | null>(null);
  const [auditRows, setAuditRows] = useState<AdminAuditLog[]>([]);
  const [auditEventType, setAuditEventType] = useState('');
  const [auditLogId, setAuditLogId] = useState('');
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsStatus, setOpsStatus] = useState('');
  const session = getAuthSession();
  const isAdmin = session.role === 'admin';

  const loadOpsData = async (params?: { status?: 'pending' | 'running' | 'completed' | 'failed' | 'abandoned' }) => {
    if (!isAdmin) {
      return;
    }
    const statusFilter = params?.status ?? retryStatusFilter;
    setOpsBusy(true);
    setOpsStatus('');
    try {
      const [kpiData, retryData, auditData] = await Promise.all([
        fetchAdminKpis(),
        fetchAdminRetryJobs({ status: statusFilter }),
        fetchAdminAuditLog({ limit: 80, eventType: auditEventType.trim() || undefined, logId: auditLogId.trim() || undefined }),
      ]);
      setKpis(kpiData);
      setRetryJobs(retryData);
      setAuditRows(auditData);
    } catch (error) {
      setOpsStatus(`Ops data load failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setOpsBusy(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    void loadRoles();
    void loadOpsData();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    void loadOpsData({ status: retryStatusFilter });
  }, [retryStatusFilter]);

  const loadRoles = async () => {
    if (!isAdmin) {
      return;
    }
    setRoleBusy(true);
    setRoleStatus('');
    try {
      const items = await listWalletRoles();
      setRoleRows(items);
    } catch (error) {
      setRoleStatus(`Load roles failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setRoleBusy(false);
    }
  };

  const onAssignRole = async () => {
    if (!assignWallet.trim()) {
      setRoleStatus('Please enter wallet address.');
      return;
    }
    setRoleBusy(true);
    setRoleStatus('');
    try {
      await grantWalletRole({ walletAddress: assignWallet.trim(), role: assignRole });
      setRoleStatus(`Assigned ${assignRole} to ${assignWallet.trim()}`);
      setAssignWallet('');
      await loadRoles();
    } catch (error) {
      setRoleStatus(`Assign failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setRoleBusy(false);
    }
  };

  const onRevokeRole = async (wallet: string) => {
    setRoleBusy(true);
    setRoleStatus('');
    try {
      await revokeWalletRole(wallet);
      setRoleStatus(`Revoked role for ${wallet}`);
      await loadRoles();
    } catch (error) {
      setRoleStatus(`Revoke failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setRoleBusy(false);
    }
  };

  const onRetryNow = async (jobId: number) => {
    setOpsBusy(true);
    setOpsStatus('');
    try {
      await retryAdminJobNow(jobId);
      setOpsStatus(`Retry job ${jobId} has been reset to pending.`);
      await loadOpsData({ status: retryStatusFilter });
    } catch (error) {
      setOpsStatus(`Retry now failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setOpsBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!file) {
      setResult('Please select a file first.');
      return;
    }

    setUploading(true);
    setResult('');
    try {
      const response = await ingestLog({
        deviceId,
        format,
        file,
      });
      setResult(`Ingest success: ${response.log_id} | hash=${response.sha256.slice(0, 12)}...`);
    } catch (error) {
      setResult(`Ingest failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Operational tools for backend connectivity and log ingestion tests.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold">Ingest Test Tool</h2>
        <p className="text-xs text-muted-foreground">
          Active Devnet Program ID: <span className="font-mono">{programId}</span>
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Device ID</label>
            <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="sensor-alpha-01" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Format</label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['JSON', 'Plain Text', 'XML', 'CSV', 'Syslog', 'GELF', 'CEF'].map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Log File</label>
          <Input
            type="file"
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              setFile(selected);
            }}
            aria-label="Upload log file"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onSubmit} disabled={uploading}>{uploading ? 'Uploading...' : 'Upload & Ingest'}</Button>
          {file && <span className="text-xs text-muted-foreground">{file.name}</span>}
        </div>

        {result && <p className="text-sm text-muted-foreground">{result}</p>}
      </div>

      <AdminSupportChat />

      {isAdmin && (
        <>
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Wallet Role Management</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Grant employee/manager roles by wallet. Unknown wallets cannot login until assigned.
                </p>
              </div>
              <Button variant="outline" onClick={loadRoles} disabled={roleBusy}>
                {roleBusy ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input
                value={assignWallet}
                onChange={(e) => setAssignWallet(e.target.value)}
                placeholder="Wallet address"
                className="md:col-span-2"
              />
              <Select value={assignRole} onValueChange={(v) => setAssignRole(v as 'employee' | 'manager')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">employee</SelectItem>
                  <SelectItem value="manager">manager</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={onAssignRole} disabled={roleBusy || !assignWallet.trim()}>
              Assign Role
            </Button>

            {roleStatus && <p className="text-xs text-muted-foreground">{roleStatus}</p>}

            <div className="space-y-2 max-h-80 overflow-auto scrollbar-thin">
              {roleRows.map((row) => (
                <div key={row.wallet_address} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div>
                    <p className="text-xs font-mono text-foreground break-all">{row.wallet_address}</p>
                    <p className="text-[11px] text-muted-foreground">role={row.role} | granted_by={row.granted_by}</p>
                  </div>
                  {row.role !== 'admin' && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onRevokeRole(row.wallet_address)}
                      disabled={roleBusy}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
              {roleRows.length === 0 && (
                <p className="text-xs text-muted-foreground">No roles found. Click Refresh.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Reliability Operations</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Monitor ingest/retry KPIs, trigger retry jobs, and inspect audit history.
                </p>
              </div>
              <Button variant="outline" onClick={() => loadOpsData({ status: retryStatusFilter })} disabled={opsBusy}>
                {opsBusy ? 'Refreshing...' : 'Refresh Ops'}
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-muted-foreground">Ingest Failure Rate</p>
                <p className="text-lg font-semibold">{kpis ? `${kpis.ingestFailureRate.toFixed(2)}%` : '-'}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-muted-foreground">Retry Backlog</p>
                <p className="text-lg font-semibold">{kpis?.retryBacklog ?? '-'}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-muted-foreground">Retry Failed</p>
                <p className="text-lg font-semibold text-destructive">{kpis?.retryFailed ?? '-'}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-muted-foreground">Audit Coverage</p>
                <p className="text-lg font-semibold">{kpis ? `${kpis.auditCoveragePct.toFixed(1)}%` : '-'}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] text-muted-foreground">Retry MTTR</p>
                <p className="text-lg font-semibold">{kpis ? `${kpis.mttrSeconds.toFixed(1)}s` : '-'}</p>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs font-semibold">Retry Jobs</p>
                <Select value={retryStatusFilter} onValueChange={(v) => setRetryStatusFilter(v as 'pending' | 'running' | 'completed' | 'failed' | 'abandoned')}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">pending</SelectItem>
                    <SelectItem value="running">running</SelectItem>
                    <SelectItem value="completed">completed</SelectItem>
                    <SelectItem value="failed">failed</SelectItem>
                    <SelectItem value="abandoned">abandoned</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 max-h-72 overflow-auto scrollbar-thin">
                {retryJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border border-border px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-mono">job={job.id} log={job.logId}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {job.status} | retry={job.retryCount}/{job.maxAttempts} | next={formatTimestamp(job.nextAttemptAt)}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onRetryNow(job.id)} disabled={opsBusy}>
                      Retry Now
                    </Button>
                  </div>
                ))}
                {retryJobs.length === 0 && (
                  <p className="text-xs text-muted-foreground">No retry jobs for selected status.</p>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-xs font-semibold">Audit Log</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  value={auditEventType}
                  onChange={(e) => setAuditEventType(e.target.value)}
                  placeholder="event_type filter"
                />
                <Input
                  value={auditLogId}
                  onChange={(e) => setAuditLogId(e.target.value)}
                  placeholder="log_id filter"
                />
                <Button variant="outline" onClick={() => loadOpsData({ status: retryStatusFilter })} disabled={opsBusy}>
                  Apply Audit Filters
                </Button>
              </div>

              <div className="space-y-2 max-h-80 overflow-auto scrollbar-thin">
                {auditRows.map((row) => (
                  <div key={row.id} className="rounded-lg border border-border px-3 py-2">
                    <p className="text-xs font-medium">{row.eventType} <span className="text-muted-foreground">#{row.id}</span></p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatTimestamp(row.createdAt)} | log={row.logId ?? '-'} | device={row.deviceId ?? '-'} | actor={row.actorWallet ? truncateAddress(row.actorWallet, 6) : '-'} ({row.actorRole ?? '-'})
                    </p>
                    <pre className="mt-1 text-[11px] bg-muted/40 rounded p-2 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(row.relatedData, null, 2)}</pre>
                  </div>
                ))}
                {auditRows.length === 0 && (
                  <p className="text-xs text-muted-foreground">No audit rows found for the current filters.</p>
                )}
              </div>
            </div>

            {opsStatus && <p className="text-xs text-muted-foreground">{opsStatus}</p>}
          </div>
        </>
      )}
    </div>
  );
};

export default SettingsPage;
