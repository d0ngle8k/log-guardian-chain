import { useEffect, useMemo, useState } from 'react';
import { Wallet, LogOut, Copy, Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { truncateAddress } from '@/lib/hashUtils';
import { WalletState, UserRole } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { clearAuthSession, getAuthSession, loginWithWallet, logoutWallet } from '@/lib/api';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu';

const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

async function fetchSolBalance(address: string): Promise<number | null> {
  try {
    const response = await fetch(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      }),
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as { result?: { value?: number } };
    const lamports = payload.result?.value;
    if (typeof lamports !== 'number') {
      return null;
    }
    return lamports / 1_000_000_000;
  } catch {
    return null;
  }
}

interface WalletButtonProps {
  wallet: WalletState;
  onConnect: (role: UserRole) => void;
  onDisconnect: () => void;
  onLoginWithPhantom?: () => void;
  onLoginWithMetamask?: () => void;
}

export function WalletButton({ wallet, onConnect, onDisconnect, onLoginWithPhantom, onLoginWithMetamask }: WalletButtonProps) {
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
          <Button
            variant="outline"
            className="gap-2 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
          >
            <Wallet className="w-4 h-4" />
            <span className="hidden sm:inline">Connect Wallet</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onLoginWithPhantom} className="gap-2 cursor-pointer">
            <span className="text-lg">🔮</span>
            <span>Connect Phantom</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onLoginWithMetamask} className="gap-2 cursor-pointer">
            <span className="text-lg">🦊</span>
            <span>Connect Metamask</span>
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
  const { publicKey, connected, disconnect: adapterDisconnect } = useWallet();
  const { setVisible: setModalVisible } = useWalletModal();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    role: 'employee',
    balance: null,
  });
  const address = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  const connect = async (_role: UserRole) => {
    // Open the wallet selection modal — the modal handles adapter selection
    // and connection; the useEffect below handles backend login on connect.
    setLoginError(null);
    setModalVisible(true);
  };

  const loginWithPhantom = async () => {
    try {
      setLoginError(null);
      const phantom = (window as any).solana;
      if (!phantom || !phantom.isPhantom) {
        setLoginError('Phantom wallet not found. Install Phantom extension.');
        return;
      }
      
      const resp = await phantom.connect();
      if (resp && resp.publicKey) {
        const walletAddress = resp.publicKey.toBase58();
        const login = await loginWithWallet(walletAddress);
        const balance = await fetchSolBalance(login.wallet_address);
        setWallet({
          connected: true,
          address: login.wallet_address,
          role: login.role,
          balance,
        });
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Phantom login failed');
      clearAuthSession();
      setWallet({ connected: false, address: null, role: 'employee', balance: null });
    }
  };

  const loginWithMetamask = async () => {
    try {
      setLoginError(null);
      const metamask = (window as any).ethereum;
      if (!metamask) {
        setLoginError('Metamask wallet not found. Install Metamask extension.');
        return;
      }
      
      // Request Solana account access if Metamask Solana support is available
      const accounts = await metamask.request?.({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) {
        setLoginError('Failed to connect Metamask wallet');
        return;
      }
      
      const walletAddress = accounts[0];
      const login = await loginWithWallet(walletAddress);
      const balance = await fetchSolBalance(login.wallet_address);
      setWallet({
        connected: true,
        address: login.wallet_address,
        role: login.role,
        balance,
      });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Metamask login failed');
      clearAuthSession();
      setWallet({ connected: false, address: null, role: 'employee', balance: null });
    }
  };

  const loginWithAddress = async (walletAddress: string) => {
    const addr = walletAddress.trim();
    if (!addr) {
      setLoginError('wallet address is required');
      return;
    }

    try {
      const login = await loginWithWallet(addr);
      const balance = await fetchSolBalance(login.wallet_address);
      setLoginError(null);
      setWallet({
        connected: true,
        address: login.wallet_address,
        role: login.role,
        balance,
      });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Wallet login failed');
      clearAuthSession();
      setWallet({ connected: false, address: null, role: 'employee', balance: null });
    }
  };

  const disconnect = async () => {
    await logoutWallet();
    clearAuthSession();
    try {
      await adapterDisconnect();
    } catch {
      // ignore adapter disconnect errors
    }
    setLoginError(null);
    setWallet({ connected: false, address: null, role: 'employee', balance: null });
  };

  useEffect(() => {
    if (!connected || !address) {
      const existing = getAuthSession();
      if (existing.token && existing.wallet && existing.role) {
        fetchSolBalance(existing.wallet).then((balance) => {
          setLoginError(null);
          setWallet({
            connected: true,
            address: existing.wallet,
            role: existing.role,
            balance,
          });
        });
        return;
      }
      setLoginError(null);
      setWallet({ connected: false, address: null, role: 'employee', balance: null });
      return;
    }

    const syncSession = async () => {
      const existing = getAuthSession();
      const balance = await fetchSolBalance(address);
      if (existing.token && existing.wallet === address) {
        setLoginError(null);
        setWallet({
          connected: true,
          address,
          role: existing.role ?? 'employee',
          balance,
        });
        return;
      }
      try {
        const login = await loginWithWallet(address);
        setLoginError(null);
        setWallet({
          connected: true,
          address,
          role: login.role,
          balance,
        });
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : 'Wallet login failed');
        clearAuthSession();
        setWallet({ connected: false, address: null, role: 'employee', balance: null });
      }
    };

    syncSession();
  }, [connected, address]);

  return { wallet, connect, disconnect, loginError, loginWithAddress, loginWithPhantom, loginWithMetamask };
}
