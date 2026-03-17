export type LogFormat = 'JSON' | 'Plain Text' | 'XML' | 'CSV' | 'Syslog' | 'GELF' | 'CEF';

export type VerificationStatus = 'verified' | 'tampered' | 'pending' | 'unverified';

export type UserRole = 'employee' | 'manager' | 'admin';

export interface LogEntry {
  id: string;
  deviceId: string;
  timestamp: number;
  ipfsCid: string;
  hashOnChain: string;
  format: LogFormat;
  fileSize: number;
  status: VerificationStatus;
  txSignature: string;
  pdaAddress: string;
}

export interface DashboardStats {
  totalLogs: number;
  verifiedLogs: number;
  tamperedLogs: number;
  activeDevices: number;
  totalStorage: string;
  networkStatus: 'connected' | 'degraded' | 'disconnected';
}

export interface ActivityItem {
  id: string;
  type: 'log_stored' | 'verification' | 'device_added' | 'alert';
  message: string;
  timestamp: number;
  deviceId?: string;
  status?: VerificationStatus;
}

export interface WalletState {
  connected: boolean;
  address: string | null;
  role: UserRole;
  balance: number | null;
}

export interface ReportedLogEntry {
  id: number;
  logId: string;
  deviceId: string;
  reportFlag: 'suspicious' | 'fraud';
  reportReason?: string | null;
  reportedByWallet: string;
  reportedByRole: string;
  createdAt: number;
  status: VerificationStatus;
}
