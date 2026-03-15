import { motion } from 'framer-motion';
import { Database, ShieldCheck, AlertTriangle, Plus } from 'lucide-react';
import { ActivityItem } from '@/lib/types';
import { timeAgo } from '@/lib/hashUtils';
import { cn } from '@/lib/utils';

const typeConfig = {
  log_stored: { icon: Database, color: 'text-primary' },
  verification: { icon: ShieldCheck, color: 'text-primary' },
  device_added: { icon: Plus, color: 'text-info' },
  alert: { icon: AlertTriangle, color: 'text-destructive' },
};

interface ActivityTimelineProps {
  items: ActivityItem[];
}

export function ActivityTimeline({ items }: ActivityTimelineProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="rounded-xl border border-border bg-card p-5"
    >
      <h3 className="text-sm font-semibold text-card-foreground mb-4">Recent Activity</h3>
      <div className="space-y-4">
        {items.map((item, i) => {
          const config = typeConfig[item.type];
          const Icon = config.icon;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.05 }}
              className="flex gap-3 items-start"
            >
              <div className={cn("p-1.5 rounded-md bg-secondary mt-0.5")}>
                <Icon className={cn("w-3.5 h-3.5", config.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-card-foreground leading-snug">{item.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(item.timestamp)}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
