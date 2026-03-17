import { Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useWalletState } from '@/components/wallet/WalletButton';
import { AIChatbox } from '@/components/AIChatbox';
import { UserRole } from '@/lib/types';
import { Input } from '@/components/ui/input';

const roleRank: Record<UserRole, number> = {
  employee: 1,
  manager: 2,
  admin: 3,
};

function minRoleForPath(pathname: string): UserRole {
  if (pathname.startsWith('/verify')) {
    return 'manager';
  }
  if (pathname.startsWith('/analytics') || pathname.startsWith('/settings')) {
    return 'admin';
  }
  return 'employee';
}

export function AppLayout() {
  const { wallet, connect, disconnect, loginError, loginWithAddress, loginWithPhantom, loginWithMetamask } = useWalletState();
  const [manualWallet, setManualWallet] = useState('');
  const location = useLocation();
  const requiredRole = minRoleForPath(location.pathname);
  const roleAllowed = roleRank[wallet.role] >= roleRank[requiredRole];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={wallet.role} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header wallet={wallet} onConnect={connect} onDisconnect={disconnect} onLoginWithPhantom={loginWithPhantom} onLoginWithMetamask={loginWithMetamask} />
        <main className="flex-1 p-4 lg:p-6 overflow-auto scrollbar-thin">
          {wallet.connected ? (
            roleAllowed ? (
              <>
                <Outlet context={{ wallet }} />
                <AIChatbox />
              </>
            ) : (
              <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
                <h1 className="text-2xl font-bold text-foreground">Access Denied</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Role <span className="font-mono">{wallet.role}</span> cannot access this page.
                </p>
              </div>
            )
          ) : (
            <div className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
              <h1 className="text-2xl font-bold text-foreground">Wallet Login Required</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Connect your wallet to access dashboard data and operational functions.
              </p>
              {loginError && (
                <p className="mt-3 text-sm text-destructive">{loginError}</p>
              )}
              
              <div className="mt-6 space-y-3">
                <button
                  className="w-full inline-flex justify-center rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20"
                  onClick={loginWithPhantom}
                >
                  <span>🔮 Login with Phantom</span>
                </button>

                <button
                  className="w-full inline-flex justify-center rounded-md border border-orange-500/30 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-600 hover:bg-orange-500/20"
                  onClick={loginWithMetamask}
                >
                  <span>🦊 Login with Metamask</span>
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Manually enter your wallet address to login directly
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={manualWallet}
                      onChange={(e) => setManualWallet(e.target.value)}
                      placeholder="Paste wallet address"
                      className="flex-1"
                    />
                    <button
                      className="inline-flex rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20 whitespace-nowrap"
                      onClick={() => loginWithAddress(manualWallet)}
                    >
                      Login
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
