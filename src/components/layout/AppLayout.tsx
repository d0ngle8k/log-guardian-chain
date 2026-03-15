import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useWalletState } from '@/components/wallet/WalletButton';

export function AppLayout() {
  const { wallet, connect, disconnect } = useWalletState();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header wallet={wallet} onConnect={connect} onDisconnect={disconnect} />
        <main className="flex-1 p-4 lg:p-6 overflow-auto scrollbar-thin">
          <Outlet context={{ wallet }} />
        </main>
      </div>
    </div>
  );
}
