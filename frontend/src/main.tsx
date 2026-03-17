import { createRoot } from "react-dom/client";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import App from "./App.tsx";
import "./index.css";
import "@solana/wallet-adapter-react-ui/styles.css";

const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

function RootApp() {
	const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
	return (
		<ConnectionProvider endpoint={SOLANA_RPC_URL}>
			<WalletProvider wallets={wallets} autoConnect>
				<WalletModalProvider>
					<App />
				</WalletModalProvider>
			</WalletProvider>
		</ConnectionProvider>
	);
}

createRoot(document.getElementById("root")!).render(<RootApp />);
