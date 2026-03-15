import { useState } from 'react';
import { Wallet, LogOut, Copy, Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { truncateAddress } from '@/lib/hashUtils';
import { WalletState, UserRole } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Mock wallet addresses
const MOCK_ADMIN = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const MOCK_VIEWER = '3nWYHbQAMXzMv5FEqGUj5yYfMfE8k2C4aTEWrvFMGJAp';

interface WalletButtonProps {
  wallet: WalletState;
  onConnect: (role: UserRole) => void;
  onDisconnect: () => void;
}

export function WalletButton({ wallet, onConnect, onDisconnect }: WalletButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (wallet.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!wallet.connected) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary">
            <Wallet className="w-4 h-4" />
            <span className="hidden sm:inline">Connect Wallet</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => onConnect('admin')} className="gap-2 cursor-pointer">
            <div className="w-5 h-5 rounded-full gradient-brand" />
            Connect as Admin (Demo)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onConnect('viewer')} className="gap-2 cursor-pointer">
            <div className="w-5 h-5 rounded-full bg-accent" />
            Connect as Viewer (Demo)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 border-primary/30 glow-primary">
          <Circle className={cn("w-2 h-2 fill-current", "text-primary")} />
          <span className="font-mono text-sm">{truncateAddress(wallet.address!, 6)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-2">
          <p className="text-xs text-muted-foreground">Connected Wallet</p>
          <p className="font-mono text-xs mt-1 text-foreground break-all">{wallet.address}</p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize">{wallet.role}</span>
            {wallet.balance !== null && (
              <span className="text-xs text-muted-foreground">{wallet.balance.toFixed(2)} SOL</span>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleCopy} className="gap-2 cursor-pointer">
          {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied!' : 'Copy Address'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDisconnect} className="gap-2 cursor-pointer text-destructive">
          <LogOut className="w-4 h-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function useWalletState() {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    role: 'viewer',
    balance: null,
  });

  const connect = (role: UserRole) => {
    setWallet({
      connected: true,
      address: role === 'admin' ? MOCK_ADMIN : MOCK_VIEWER,
      role,
      balance: 4.2069,
    });
  };

  const disconnect = () => {
    setWallet({ connected: false, address: null, role: 'viewer', balance: null });
  };

  return { wallet, connect, disconnect };
}
