import { ShieldCheck, ShieldAlert, Clock, ShieldQuestion } from 'lucide-react';
import { VerificationStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const statusConfig: Record<VerificationStatus, { icon: typeof ShieldCheck; label: string; className: string }> = {
  verified: { icon: ShieldCheck, label: 'Verified', className: 'bg-primary/10 text-primary border-primary/20' },
  tampered: { icon: ShieldAlert, label: 'Tampered', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  pending: { icon: Clock, label: 'Pending', className: 'bg-warning/10 text-warning border-warning/20' },
  unverified: { icon: ShieldQuestion, label: 'Unverified', className: 'bg-muted text-muted-foreground border-border' },
};

function normalizeStatus(status: string): VerificationStatus {
  const value = status.trim().toLowerCase();
  if (value === 'verified' || value === 'tampered' || value === 'pending' || value === 'unverified') {
    return value;
  }
  if (value.startsWith('pending')) {
    return 'pending';
  }
  if (value === 'confirmed') {
    return 'verified';
  }
  return 'pending';
}

export function StatusBadge({ status }: { status: VerificationStatus | string }) {
  const normalized = normalizeStatus(String(status ?? ''));
  const config = statusConfig[normalized];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border", config.className)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}
