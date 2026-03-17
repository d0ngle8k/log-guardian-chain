import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getAuthSession, grantWalletRole, ingestLog, listWalletRoles, revokeWalletRole, WalletRoleRecord } from '@/lib/api';
import { AdminSupportChat } from '@/components/support/AdminSupportChat';

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
  const session = getAuthSession();
  const isAdmin = session.role === 'admin';

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
      )}
    </div>
  );
};

export default SettingsPage;
