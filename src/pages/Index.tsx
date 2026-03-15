import { Database, ShieldCheck, AlertTriangle, Cpu, HardDrive, Wifi } from 'lucide-react';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline';
import { mockStats, mockActivity } from '@/lib/mockData';
import { motion } from 'framer-motion';

const Dashboard = () => {
  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Blockchain log storage overview</p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatsCard title="Total Logs" value={mockStats.totalLogs} icon={Database} trend="+142 today" variant="default" delay={0} />
        <StatsCard title="Verified" value={mockStats.verifiedLogs} icon={ShieldCheck} trend="92.8% rate" variant="success" delay={0.05} />
        <StatsCard title="Tampered" value={mockStats.tamperedLogs} icon={AlertTriangle} variant="destructive" delay={0.1} />
        <StatsCard title="Devices" value={mockStats.activeDevices} icon={Cpu} trend="All online" variant="default" delay={0.15} />
        <StatsCard title="Storage" value={mockStats.totalStorage} icon={HardDrive} variant="default" delay={0.2} />
        <StatsCard title="Network" value="Devnet" icon={Wifi} trend="Connected" variant="success" delay={0.25} />
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ActivityTimeline items={mockActivity} />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="rounded-xl border border-border bg-card p-5"
        >
          <h3 className="text-sm font-semibold text-card-foreground mb-4">Quick Actions</h3>
          <div className="space-y-2">
            {[
              { label: 'Verify Latest Batch', desc: 'Run integrity check on recent logs' },
              { label: 'Export Report', desc: 'Download verification report as CSV' },
              { label: 'Device Status', desc: 'Check all connected device health' },
            ].map((action, i) => (
              <button
                key={i}
                className="w-full text-left p-3 rounded-lg bg-secondary hover:bg-primary/10 hover:border-primary/20 border border-transparent transition-all group"
              >
                <p className="text-sm font-medium text-card-foreground group-hover:text-primary transition-colors">{action.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;
