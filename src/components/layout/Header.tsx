import { Wifi, WifiOff } from 'lucide-react';
import { MobileNav } from './Sidebar';
import { WalletButton } from '@/components/wallet/WalletButton';
import { WalletState, UserRole } from '@/lib/types';

interface HeaderProps {
  wallet: WalletState;
  onConnect: (role: UserRole) => void;
  onDisconnect: () => void;
}

export function Header({ wallet, onConnect, onDisconnect }: HeaderProps) {
  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <MobileNav />
        <div className="flex items-center gap-2 text-sm">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
            <Wifi className="w-3 h-3 text-primary" />
            <span className="text-primary text-xs font-medium">Devnet</span>
          </div>
        </div>
      </div>
      <WalletButton wallet={wallet} onConnect={onConnect} onDisconnect={onDisconnect} />
    </header>
  );
}
