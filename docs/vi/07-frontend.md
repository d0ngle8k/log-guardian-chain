# 7. Frontend

## 7.1 Tong Quan

| Thuoc tinh | Gia tri |
|------------|---------|
| **Framework** | React 18 + TypeScript |
| **Build tool** | Vite (voi SWC) |
| **CSS** | Tailwind CSS |
| **UI Library** | shadcn/ui (~50 components) |
| **Charts** | Recharts |
| **Animation** | Framer Motion |
| **Wallet** | @solana/wallet-adapter |
| **State** | @tanstack/react-query |
| **Validation** | Zod |
| **Dev port** | 8080 |
| **Source** | `frontend/src/` |

## 7.2 Cau Truc Thu Muc

```
frontend/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── index.html
└── src/
    ├── main.tsx              # Entry point (Solana providers)
    ├── App.tsx               # Router setup
    ├── pages/                # Cac trang chinh
    │   ├── Index.tsx         # Dashboard
    │   ├── LogsPage.tsx      # Log Explorer
    │   ├── AnalyticsPage.tsx # Analytics
    │   ├── SettingsPage.tsx  # Settings + Admin
    │   ├── VerifyPage.tsx    # Batch Verification
    │   └── NotFound.tsx      # 404
    ├── components/
    │   ├── layout/           # Layout components
    │   │   ├── AppLayout.tsx
    │   │   ├── Header.tsx
    │   │   └── Sidebar.tsx
    │   ├── wallet/           # Wallet components
    │   │   └── WalletButton.tsx
    │   ├── dashboard/        # Dashboard components
    │   │   ├── StatsCard.tsx
    │   │   └── ActivityTimeline.tsx
    │   ├── support/          # Support components
    │   │   └── AdminSupportChat.tsx
    │   ├── ui/               # shadcn/ui components (~50 files)
    │   │   ├── StatusBadge.tsx  # Custom status badge
    │   │   └── ...
    │   ├── AIChatbox.tsx     # AI chatbot
    │   ├── ErrorBoundary.tsx # Error boundary
    │   ├── NavLink.tsx       # Navigation link
    │   └── PlaceholderPage.tsx
    ├── hooks/
    │   ├── use-theme.tsx     # Dark/light theme
    │   ├── use-mobile.tsx    # Mobile detection
    │   └── use-toast.ts      # Toast notifications
    └── lib/
        ├── api.ts            # API client (451 lines)
        ├── types.ts          # Type definitions
        ├── utils.ts          # Utility: cn()
        ├── hashUtils.ts      # Hash/format utilities
        └── mockData.ts       # Mock data for dev
```

## 7.3 Entry Point (`main.tsx`)

```typescript
// Thiet lap providers
<ConnectionProvider endpoint={SOLANA_RPC_URL}>
  <WalletProvider wallets={[PhantomWalletAdapter()]}>
    <WalletModalProvider>
      <App />
    </WalletModalProvider>
  </WalletProvider>
</ConnectionProvider>
```

- Ket noi Solana RPC qua `VITE_SOLANA_RPC_URL` (mac dinh: `https://api.devnet.solana.com`)
- Ho tro Phantom Wallet adapter

## 7.4 Routing (`App.tsx`)

| Route | Component | Mo ta |
|-------|-----------|-------|
| `/` | `Index` | Dashboard |
| `/logs` | `LogsPage` | Log Explorer |
| `/analytics` | `AnalyticsPage` | Phan tich |
| `/settings` | `SettingsPage` | Cai dat |
| `/verify` | `VerifyPage` | Xac minh hang loat |
| `*` | `NotFound` | Trang 404 |

Tat ca routes duoc boc trong `AppLayout` de co sidebar va header.

## 7.5 Cac Trang Chi Tiet

### 7.5.1 Dashboard (`Index.tsx` - 261 dong)

Trang chinh hien thi tong quan he thong.

**Thanh phan**:
- **Stats Cards**: Total Logs, Verified, Tampered, Suspicious, Devices, Storage
- **Network Status**: Trang thai ket noi (Devnet Connected / Disconnected)
- **Activity Timeline**: Cac hoat dong gan day
- **Quick Actions**: Verify Latest Batch, Export Report, Settings, How to Use

**Du lieu**: Goi `fetchDashboardStats()` va `fetchActivity()` khi load trang.

**Risk Flags**: Tinh so luong suspicious/fraud flags tu localStorage.

### 7.5.2 Log Explorer (`LogsPage.tsx` - 754 dong)

Trang kham pha va quan ly log chi tiet nhat.

**Tinh nang**:
- **Tim kiem**: Theo device ID, IPFS CID, hoac log ID
- **Bo loc**: Theo format (JSON, Plain Text, XML...) va trang thai xac minh
- **Phan trang**: Dieu huong giua cac trang
- **Chon log**: Checkbox de chon nhieu log
- **Xac minh**: Xac minh tung log hoac hang loat
- **Bao cao**: Bao cao log la suspicious hoac fraud
- **Chi tiet**: Xem noi dung log, hash, IPFS CID, tx signature
- **Lien ket**: Link den Solana Explorer va IPFS gateway

**Thao tac hang loat (Batch Operations)**:
- Verify All: Xac minh tat ca log tren trang hien tai
- Verify Selected: Xac minh cac log da chon
- Report Selected: Bao cao cac log da chon

### 7.5.3 Analytics (`AnalyticsPage.tsx` - 303 dong)

Dashboard phan tich voi bieu do.

**Bieu do**:
- **Logs by Device**: Bieu do cot (Bar Chart) - so log theo thiet bi
- **Verification Status Mix**: Bieu do tron (Pie Chart) - phan bo trang thai

**Thong ke**:
- Total Logs, Verified, Tampered, Storage
- Suspicious flags, Fraud flags

**Bang Reported Logs**: Hien thi cac log da bi bao cao voi cot:
- Log ID, Device, Flag, Reason, Status, Reported By, Role, Time

**Quyen**: Chi admin moi truy cap duoc.

### 7.5.4 Settings (`SettingsPage.tsx` - 403 dong)

Trang cai dat va cong cu quan tri.

**Ingest Test Tool** (tat ca vai tro khi da dang nhap):
- Upload file log
- Chon device ID va format
- Gui den API ingest de test

**Admin Features** (chi admin):

1. **Wallet Role Management**:
   - Xem danh sach vai tro hien tai
   - Gan vai tro moi (employee/manager/admin) cho wallet
   - Thu hoi vai tro

2. **Reliability Operations**:
   - **KPIs**: Ingest failure rate, retry backlog, retry failed, audit coverage, MTTR
   - **Retry Jobs**: Danh sach cac jobs dang cho xu ly lai
   - **Audit Log**: Lich su cac hanh dong he thong

### 7.5.5 Batch Verification (`VerifyPage.tsx` - 195 dong)

Trang xac minh nhieu log cung luc.

**Luong**:
1. Chon cac log can xac minh
2. Nhan "Run Batch Verification"
3. He thong chay xac minh tung log
4. Hien thi ket qua: client-side hash check va server verification

**Quyen**: Tu manager tro len.

### 7.5.6 Not Found (`NotFound.tsx` - 25 dong)

Trang loi 404 don gian voi link quay lai trang chu.

## 7.6 Components Quan Trong

### 7.6.1 AppLayout (`layout/AppLayout.tsx` - 114 dong)

Layout chinh cua ung dung.

**Chuc nang**:
- Kiem tra role-based access cho tung route
- Hien thi "Access Denied" neu khong du quyen
- Hien thi "Wallet Login Required" neu chua dang nhap
- 3 phuong thuc dang nhap: Phantom, Metamask, nhap tay dia chi wallet

**Role routing**:

| Route | Quyen toi thieu |
|-------|----------------|
| `/verify` | manager |
| `/analytics`, `/settings` | admin |
| Con lai | employee |

### 7.6.2 Sidebar (`layout/Sidebar.tsx` - 180 dong)

Thanh dieu huong ben trai.

**Tinh nang**:
- Co the thu gon/mo rong (animated)
- Loc menu theo vai tro nguoi dung
- Hieu ung active cho trang hien tai
- Mobile responsive (MobileNav component rieng)

**Menu items**:

| Icon | Label | Path | Min Role |
|------|-------|------|----------|
| LayoutDashboard | Dashboard | `/` | employee |
| FileSearch | Log Explorer | `/logs` | employee |
| Activity | Analytics | `/analytics` | admin |
| Settings | Settings | `/settings` | admin |

### 7.6.3 WalletButton & useWalletState (`wallet/WalletButton.tsx` - 292 dong)

**WalletButton component**:
- Khi chua ket noi: Hien nut "Connect Wallet" voi dropdown chon Phantom/Metamask
- Khi da ket noi: Hien dia chi rut gon, vai tro, so du SOL, nut copy/disconnect

**useWalletState hook**:
- Quan ly trang thai ket noi wallet
- Ho tro 3 cach dang nhap:
  1. **Phantom**: Ket noi qua Phantom browser extension
  2. **Metamask**: Ket noi qua Metamask extension (eth_requestAccounts)
  3. **Manual**: Nhap truc tiep dia chi wallet
- Tu dong phuc hoi phien tu localStorage khi reload trang
- Goi `loginWithWallet()` API de lay JWT token
- Lay so du SOL tu Solana RPC

### 7.6.4 AIChatbox (`AIChatbox.tsx` - 520 dong)

Chatbot AI noi (floating) tich hop tren moi trang.

**Tinh nang**:
- Nut noi co the keo tha (draggable launcher)
- Panel chat co the thay doi kich thuoc (resizable) tu 8 huong
- Co the thu nho (minimize) va dong
- Luu vi tri launcher vao localStorage
- Ho tro markdown (bold, italic, code)
- Powered by Gemini API

**Tuong tac**:
- Nguoi dung nhap cau hoi ve log, blockchain, IPFS...
- Gui den backend `/api/v1/admin/support/chat`
- Hien thi cau tra loi tu AI

### 7.6.5 AdminSupportChat (`support/AdminSupportChat.tsx` - 95 dong)

Chat support danh rieng cho admin tren trang Settings.

**Tinh nang**:
- Chi hien thi khi vai tro la admin
- Co the paste error context (stack trace, RPC failure)
- Gui prompt den Gemini API qua backend
- Hien thi lich su hoi dap

### 7.6.6 StatusBadge (`ui/StatusBadge.tsx` - 37 dong)

Badge hien thi trang thai xac minh voi mau sac va icon.

| Trang thai | Mau | Icon |
|------------|-----|------|
| `verified` | Xanh (primary) | ShieldCheck |
| `tampered` | Do (destructive) | ShieldAlert |
| `pending` | Vang (warning) | Clock |
| `unverified` | Xam (muted) | ShieldQuestion |

**Chuyen doi trang thai**:
- `confirmed` -> `verified`
- `pending_*` -> `pending`
- Khong nhan dang -> `pending`

## 7.7 Hooks

### useTheme (`hooks/use-theme.tsx`)

Chuyen doi giua light va dark mode.

- Luu trang thai vao localStorage
- Mac dinh theo system preference
- Toggle class `.light` tren `<html>` element

### useIsMobile (`hooks/use-mobile.tsx`)

Phat hien man hinh mobile (< 768px).

- Su dung `window.matchMedia` de lang nghe thay doi
- Tra ve boolean `isMobile`

### useToast (`hooks/use-toast.ts`)

Quan ly toast notifications (shadcn/ui toast system).

## 7.8 API Client (`lib/api.ts`)

Module giao tiep voi backend API.

**Xac thuc**:
- Luu token, role, wallet vao `localStorage`:
  - `guardian_log_token`
  - `guardian_log_role`
  - `guardian_log_wallet`
- Tu dong dinh kem `Authorization: Bearer <token>` header

**Base URL**: Doc tu `VITE_BACKEND_URL` hoac mac dinh `/api/v1`

**Xu ly loi**: Throw Error voi thong bao tu server hoac generic message

### Danh sach ham

| Ham | Method | Endpoint | Mo ta |
|-----|--------|----------|-------|
| `loginWithWallet` | POST | `/auth/wallet/login` | Dang nhap |
| `logoutWallet` | POST | `/auth/logout` | Dang xuat |
| `fetchLogs` | GET | `/logs` | Lay danh sach log |
| `verifyLog` | POST | `/logs/{id}/verify` | Xac minh log |
| `reportLog` | POST | `/logs/{id}/report` | Bao cao log |
| `fetchDashboardStats` | GET | `/dashboard/stats` | Thong ke |
| `fetchActivity` | GET | `/activity` | Hoat dong |
| `ingestLog` | POST | `/logs/ingest` | Upload log |
| `verifyLogClientSide` | — | — | Xac minh hash phia client |
| `sendChatMessage` | POST | `/admin/support/chat` | Chat AI |
| `fetchAdminRetryJobs` | GET | `/admin/retry-jobs` | Retry jobs |
| `fetchAdminKpis` | GET | `/admin/kpis` | KPIs |
| `fetchAdminAuditLog` | GET | `/admin/audit-log` | Audit log |
| `listWalletRoles` | GET | `/admin/roles` | Danh sach vai tro |
| `grantWalletRole` | POST | `/admin/roles` | Gan vai tro |
| `revokeWalletRole` | DELETE | `/admin/roles` | Thu hoi vai tro |

## 7.9 Utility Functions (`lib/hashUtils.ts`)

| Ham | Mo ta | Vi du |
|-----|-------|-------|
| `computeSHA256(data)` | Tinh SHA-256 hash (browser native) | `"abc"` -> `"ba7816bf..."` |
| `truncateHash(hash, chars)` | Rut gon hash de hien thi | `"abcd...wxyz"` |
| `truncateAddress(addr, chars)` | Rut gon dia chi wallet | `"AbCd...WxYz"` |
| `formatFileSize(bytes)` | Dinh dang kich thuoc file | `2048` -> `"2.0 KB"` |
| `formatTimestamp(ts)` | Dinh dang thoi gian | `1773721921209` -> `"Mar 15, 10:23:45"` |
| `timeAgo(ts)` | Thoi gian tuong doi | `"5m ago"`, `"2h ago"` |

## 7.10 Bien Moi Truong

| Bien | Mac dinh | Mo ta |
|------|----------|-------|
| `VITE_BACKEND_URL` | — | URL cua backend API |
| `VITE_SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `VITE_SOLANA_PROGRAM_ID` | — | Program ID tren blockchain |

## 7.11 Scripts

| Script | Lenh | Mo ta |
|--------|------|-------|
| `dev` | `vite` | Chay dev server (port 8080) |
| `build` | `tsc && vite build` | Build production |
| `build:dev` | `vite build --mode development` | Build dev mode |
| `lint` | `eslint .` | Kiem tra lint |
| `preview` | `vite preview` | Preview production build |
| `test` | `vitest run` | Chay unit tests |
| `test:watch` | `vitest` | Chay tests o watch mode |
