import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, ChevronLeft, ChevronRight, ExternalLink, Eye } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { VerificationModal } from '@/components/logs/VerificationModal';
import { mockLogs } from '@/lib/mockData';
import { truncateHash, formatFileSize, formatTimestamp } from '@/lib/hashUtils';
import { LogEntry } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE = 15;

const LogsPage = () => {
  const [search, setSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  const filtered = useMemo(() => {
    return mockLogs.filter(log => {
      const matchSearch = !search || 
        log.deviceId.toLowerCase().includes(search.toLowerCase()) ||
        log.ipfsCid.toLowerCase().includes(search.toLowerCase()) ||
        log.id.toLowerCase().includes(search.toLowerCase());
      const matchFormat = formatFilter === 'all' || log.format === formatFilter;
      const matchStatus = statusFilter === 'all' || log.status === statusFilter;
      return matchSearch && matchFormat && matchStatus;
    });
  }, [search, formatFilter, statusFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4 max-w-7xl">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold text-foreground">Log Explorer</h1>
        <p className="text-sm text-muted-foreground mt-1">Browse and verify blockchain-stored log entries</p>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex flex-wrap gap-3"
      >
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by device ID, CID, or log ID..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9 bg-card border-border"
          />
        </div>
        <Select value={formatFilter} onValueChange={(v) => { setFormatFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px] bg-card border-border">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Formats</SelectItem>
            {['JSON', 'Plain Text', 'XML', 'CSV', 'Syslog', 'GELF', 'CEF'].map(f => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px] bg-card border-border">
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
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-xl border border-border bg-card overflow-hidden"
      >
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">ID</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Device</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Format</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">IPFS CID</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Hash</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Size</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((log, i) => (
                <motion.tr
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{log.id}</td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{log.deviceId}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{log.format}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-accent">{truncateHash(log.ipfsCid, 6)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{truncateHash(log.hashOnChain, 6)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatFileSize(log.fileSize)}</td>
                  <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedLog(log)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <a href={`https://explorer.solana.com/tx/${log.txSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </Button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">Page {page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Verification Modal */}
      {selectedLog && (
        <VerificationModal log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </div>
  );
};

export default LogsPage;
