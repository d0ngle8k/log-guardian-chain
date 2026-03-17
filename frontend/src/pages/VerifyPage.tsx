import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { fetchLogs, verifyLog, verifyLogClientSide } from '@/lib/api';
import { LogEntry } from '@/lib/types';
import { CheckCircle2 } from 'lucide-react';

interface VerificationOutcome {
  logId: string;
  expectedHash: string;
  actualHash: string;
  clientVerified: boolean;
  serverSynced: boolean;
}

const VerifyPage = () => {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [resultMessage, setResultMessage] = useState<string>('');
  const [outcomes, setOutcomes] = useState<Record<string, VerificationOutcome>>({});

  const logsQuery = useQuery({
    queryKey: ['verify-page-logs'],
    queryFn: () => fetchLogs({ page: 1, pageSize: 200, status: 'all' }),
    retry: 1,
  });

  const pendingLogs = useMemo(() => {
    const items = logsQuery.data?.items ?? [];
    return items.filter((item) => item.status !== 'verified');
  }, [logsQuery.data?.items]);

  const selectedIds = Object.entries(selected)
    .filter(([, checked]) => checked)
    .map(([id]) => id);

  const toggleSelect = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const runBatchVerification = async () => {
    if (selectedIds.length === 0) {
      setResultMessage('Select at least one log to verify.');
      return;
    }

    setIsRunning(true);
    setResultMessage('');
    try {
      const logMap = new Map(pendingLogs.map((item) => [item.id, item]));
      const selectedLogs = selectedIds
        .map((id) => logMap.get(id))
        .filter((item): item is LogEntry => Boolean(item));

      const results = await Promise.all(
        selectedLogs.map(async (log) => {
          const clientResult = await verifyLogClientSide(log);
          const serverResult = await verifyLog(log.id);
          return {
            logId: log.id,
            expectedHash: clientResult.expectedHash,
            actualHash: clientResult.actualHash,
            clientVerified: clientResult.verified,
            serverSynced: serverResult.verified === clientResult.verified,
          };
        }),
      );

      const nextOutcomes = { ...outcomes };
      for (const item of results) {
        nextOutcomes[item.logId] = item;
      }
      setOutcomes(nextOutcomes);

      const verifiedCount = results.filter((item) => item.clientVerified).length;
      const tamperedCount = results.length - verifiedCount;
      setResultMessage(`Batch finished: ${verifiedCount} verified, ${tamperedCount} tampered.`);
      setSelected({});
      await logsQuery.refetch();
    } catch (error) {
      setResultMessage(`Batch verification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Batch Verification</h1>
        <p className="text-sm text-muted-foreground mt-1">Run integrity checks and update status for selected logs.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {logsQuery.isLoading
              ? 'Loading logs...'
              : `${pendingLogs.length} logs require verification`}
          </p>
          <Button onClick={runBatchVerification} disabled={isRunning || selectedIds.length === 0}>
            {isRunning ? 'Running...' : `Verify Selected (${selectedIds.length})`}
          </Button>
        </div>
        {resultMessage && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" />
            {resultMessage}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left">Select</th>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Device</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Client Hash Check</th>
                <th className="px-4 py-3 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingLogs.map((log: LogEntry) => (
                <tr key={log.id} className="border-b border-border/50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[log.id])}
                      onChange={() => toggleSelect(log.id)}
                      aria-label={`Select ${log.id} for verification`}
                      title={`Select ${log.id}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{log.id}</td>
                  <td className="px-4 py-3 font-mono text-xs">{log.deviceId}</td>
                  <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                  <td className="px-4 py-3">
                    {outcomes[log.id] ? (
                      <span className={outcomes[log.id].clientVerified ? 'text-emerald-600' : 'text-destructive'}>
                        {outcomes[log.id].clientVerified ? 'Verified' : 'Tampered'}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not checked</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const clientResult = await verifyLogClientSide(log);
                          const serverResult = await verifyLog(log.id);
                          setOutcomes((prev) => ({
                            ...prev,
                            [log.id]: {
                              logId: log.id,
                              expectedHash: clientResult.expectedHash,
                              actualHash: clientResult.actualHash,
                              clientVerified: clientResult.verified,
                              serverSynced: serverResult.verified === clientResult.verified,
                            },
                          }));
                          await logsQuery.refetch();
                        } catch (error) {
                          setResultMessage(`Verify ${log.id} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
                        }
                      }}
                    >
                      Verify
                    </Button>
                  </td>
                </tr>
              ))}
              {!logsQuery.isLoading && pendingLogs.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={6}>No pending logs. Everything is verified.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default VerifyPage;
