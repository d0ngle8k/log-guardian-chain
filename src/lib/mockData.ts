import { LogEntry, DashboardStats, ActivityItem, LogFormat, VerificationStatus } from './types';

const formats: LogFormat[] = ['JSON', 'Plain Text', 'XML', 'CSV', 'Syslog', 'GELF', 'CEF'];
const statuses: VerificationStatus[] = ['verified', 'verified', 'verified', 'pending', 'unverified'];
const deviceIds = ['sensor-alpha-01', 'gateway-bravo-02', 'node-charlie-03', 'edge-delta-04', 'hub-echo-05', 'relay-foxtrot-06'];

function randomHex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function randomCid(): string {
  return `Qm${randomHex(44)}`;
}

function randomSolAddress(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array.from({ length: 44 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function generateMockLogs(count: number): LogEntry[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    id: `log-${String(i + 1).padStart(4, '0')}`,
    deviceId: deviceIds[Math.floor(Math.random() * deviceIds.length)],
    timestamp: now - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000),
    ipfsCid: randomCid(),
    hashOnChain: randomHex(64),
    format: formats[Math.floor(Math.random() * formats.length)],
    fileSize: Math.floor(Math.random() * 500000) + 1000,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    txSignature: randomHex(88),
    pdaAddress: randomSolAddress(),
  })).sort((a, b) => b.timestamp - a.timestamp);
}

export const mockStats: DashboardStats = {
  totalLogs: 12847,
  verifiedLogs: 11923,
  tamperedLogs: 3,
  activeDevices: 6,
  totalStorage: '2.4 GB',
  networkStatus: 'connected',
};

export const mockActivity: ActivityItem[] = [
  { id: '1', type: 'log_stored', message: 'New log stored from sensor-alpha-01', timestamp: Date.now() - 120000, deviceId: 'sensor-alpha-01' },
  { id: '2', type: 'verification', message: 'Batch verification completed: 24 logs verified', timestamp: Date.now() - 600000, status: 'verified' },
  { id: '3', type: 'device_added', message: 'New device registered: relay-foxtrot-06', timestamp: Date.now() - 1800000 },
  { id: '4', type: 'alert', message: 'Integrity alert: hash mismatch detected', timestamp: Date.now() - 3600000, status: 'tampered' },
  { id: '5', type: 'log_stored', message: 'Bulk upload: 156 logs from gateway-bravo-02', timestamp: Date.now() - 7200000, deviceId: 'gateway-bravo-02' },
  { id: '6', type: 'verification', message: 'Scheduled verification: all clear', timestamp: Date.now() - 14400000, status: 'verified' },
];

export const mockLogs = generateMockLogs(200);

export const sampleLogContent = `{
  "timestamp": "2026-03-15T10:23:45.123Z",
  "level": "INFO",
  "device_id": "sensor-alpha-01",
  "event": "temperature_reading",
  "data": {
    "value": 23.5,
    "unit": "celsius",
    "sensor_type": "DHT22",
    "location": "warehouse-A-rack-12"
  },
  "metadata": {
    "firmware_version": "2.1.4",
    "battery_level": 87,
    "signal_strength": -42
  }
}`;
