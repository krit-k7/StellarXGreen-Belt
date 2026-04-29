import { useState, useEffect, useRef } from 'react';
import { useWallet } from './hooks/useWallet';
import { VAULT_CONTRACT_ID, TOKEN_CONTRACT_ID, RPC_URL } from './config';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  Globe2, Wallet, Send, Loader2, CheckCircle2, AlertCircle,
  TrendingUp, ArrowRight, Zap, RefreshCw, ExternalLink, Copy,
  DollarSign, Users, Activity, Info, ChevronDown
} from 'lucide-react';
import './App.css';

const server = new StellarSdk.rpc.Server(RPC_URL);

// Currency configurations
const CURRENCIES = [
  { code: 1, symbol: 'USD', flag: '🇺🇸', name: 'US Dollar',       rate: 0.11,  color: '#22c55e' },
  { code: 2, symbol: 'EUR', flag: '🇪🇺', name: 'Euro',            rate: 0.10,  color: '#3b82f6' },
  { code: 3, symbol: 'INR', flag: '🇮🇳', name: 'Indian Rupee',    rate: 9.16,  color: '#f97316' },
  { code: 4, symbol: 'PHP', flag: '🇵🇭', name: 'Philippine Peso', rate: 6.37,  color: '#a855f7' },
  { code: 5, symbol: 'MXN', flag: '🇲🇽', name: 'Mexican Peso',    rate: 1.94,  color: '#ec4899' },
];

function formatXLM(n) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatConverted(amount, currencyCode) {
  const cur = CURRENCIES.find(c => c.code === currencyCode);
  if (!cur) return amount;
  // Amount from contract is already converted (XLM * rate_scaled / 100)
  // For display we show as decimal
  const val = Number(amount) / 100;
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function App() {
  const { address, isConnecting, connect, disconnect, signTransaction, error: walletError } = useWallet();
  const [xlmAmount, setXlmAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState(CURRENCIES[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userStats, setUserStats] = useState(null);
  const [globalStats, setGlobalStats] = useState({ count: 0, volume: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [txStatus, setTxStatus] = useState(null);
  const [uiError, setUiError] = useState(null);
  const [events, setEvents] = useState([]);
  const [copied, setCopied] = useState(false);
  const eventsRef = useRef(null);

  useEffect(() => {
    if (walletError) setUiError(walletError.message);
  }, [walletError]);

  // Real-time event polling
  useEffect(() => {
    const pollEvents = async () => {
      try {
        const latestLedger = await server.getLatestLedger();
        const startLedger = Math.max(1, latestLedger.sequence - 1000);
        const response = await server.getEvents({
          startLedger,
          filters: [{ type: 'contract', contractIds: [VAULT_CONTRACT_ID] }],
          limit: 20,
        });
        if (response.events && response.events.length > 0) {
          setEvents(response.events.slice(-8).reverse());
        }
      } catch (e) { /* events may not be available yet */ }
    };
    pollEvents();
    const interval = setInterval(pollEvents, 15000);
    return () => clearInterval(interval);
  }, []);

  // Fetch user & global stats via simulation
  const fetchStats = async (addr) => {
    if (!addr) return;
    setIsRefreshing(true);
    try {
      const contract = new StellarSdk.Contract(VAULT_CONTRACT_ID);
      const dummyAccount = new StellarSdk.Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
      const netPass = StellarSdk.Networks.TESTNET;

      // Get user total
      const userTx = new StellarSdk.TransactionBuilder(dummyAccount, { fee: '100', networkPassphrase: netPass })
        .addOperation(contract.call('get_user_total', new StellarSdk.Address(addr).toScVal()))
        .setTimeout(30).build();
      const userSim = await server.simulateTransaction(userTx);
      const userTotal = StellarSdk.rpc.Api.isSimulationSuccess(userSim) && userSim.result?.retval
        ? Number(StellarSdk.scValToNative(userSim.result.retval))
        : 0;

      // Get global count
      const countTx = new StellarSdk.TransactionBuilder(dummyAccount, { fee: '100', networkPassphrase: netPass })
        .addOperation(contract.call('get_remittance_count'))
        .setTimeout(30).build();
      const countSim = await server.simulateTransaction(countTx);
      const count = StellarSdk.rpc.Api.isSimulationSuccess(countSim) && countSim.result?.retval
        ? Number(StellarSdk.scValToNative(countSim.result.retval))
        : 0;

      // Get global volume
      const volTx = new StellarSdk.TransactionBuilder(dummyAccount, { fee: '100', networkPassphrase: netPass })
        .addOperation(contract.call('get_global_volume'))
        .setTimeout(30).build();
      const volSim = await server.simulateTransaction(volTx);
      const volume = StellarSdk.rpc.Api.isSimulationSuccess(volSim) && volSim.result?.retval
        ? Number(StellarSdk.scValToNative(volSim.result.retval))
        : 0;

      setUserStats({ totalSent: userTotal });
      setGlobalStats({ count, volume });
    } catch (e) {
      console.error('Stats fetch error:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (address) fetchStats(address);
  }, [address]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!address) { setUiError('Connect your Freighter wallet first.'); return; }
    if (!xlmAmount || isNaN(xlmAmount) || Number(xlmAmount) <= 0) {
      setUiError('Enter a valid XLM amount to send.'); return;
    }

    if (!recipient || recipient.length !== 56 || !recipient.startsWith('G')) {
      setUiError('Enter a valid recipient Stellar address.'); return;
    }

    setIsSubmitting(true);
    setTxStatus({
      status: 'pending',
      title: 'Processing Remittance...',
      desc: `Routing ${xlmAmount} XLM → ${selectedCurrency.symbol} via Stellar`
    });
    setUiError(null);

    try {
      const contract = new StellarSdk.Contract(VAULT_CONTRACT_ID);
      const sourceAccount = await server.getAccount(address);

      let tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: '10000000',
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(contract.call(
          'send_remittance',
          new StellarSdk.Address(TOKEN_CONTRACT_ID).toScVal(),
          new StellarSdk.Address(address).toScVal(),
          new StellarSdk.Address(recipient).toScVal(),
          StellarSdk.nativeToScVal(BigInt(Math.round(Number(xlmAmount))), { type: 'i128' }),
          StellarSdk.nativeToScVal(selectedCurrency.code, { type: 'u32' })
        ))
        .setTimeout(60)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (!StellarSdk.rpc.Api.isSimulationSuccess(sim)) throw new Error('Simulation failed. Check contract state.');

      tx = StellarSdk.rpc.assembleTransaction(tx, sim).build();
      const signedXdr = await signTransaction(tx.toXDR());
      const response = await server.sendTransaction(
        StellarSdk.TransactionBuilder.fromXDR(signedXdr, StellarSdk.Networks.TESTNET)
      );

      if (response.status !== 'ERROR') {
        const convertedAmount = Number(xlmAmount) * selectedCurrency.rate;
        setTxStatus({
          status: 'success',
          title: '✅ Remittance Sent!',
          desc: `${xlmAmount} XLM → ~${convertedAmount.toFixed(2)} ${selectedCurrency.symbol} • Settled in ~5 seconds`,
          hash: response.hash,
          converted: convertedAmount,
          currency: selectedCurrency
        });
        setXlmAmount('');
        setTimeout(() => fetchStats(address), 3000);
      } else {
        throw new Error('Transaction failed on network.');
      }
    } catch (err) {
      setUiError(err.message);
      setTxStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const previewConversion = () => {
    if (!xlmAmount || isNaN(xlmAmount) || Number(xlmAmount) <= 0) return null;
    return (Number(xlmAmount) * selectedCurrency.rate).toFixed(2);
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const preview = previewConversion();

  return (
    <div className="app-container">
      {/* Background orbs */}
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="bg-orb orb-3" />

      {/* Header */}
      <header className="header">
        <div className="logo">
          <Globe2 size={28} className="logo-icon" />
          <span>StellarRemit</span>
          <span className="badge">Testnet</span>
        </div>
        <div className="header-center">
          <span className="header-tagline">Borderless Money Transfer on Stellar</span>
        </div>
        <div className="header-right">
          {address ? (
            <div className="wallet-connected">
              <div className="wallet-badge" onClick={copyAddress}>
                <Wallet size={15} />
                <span>{address.slice(0, 6)}...{address.slice(-4)}</span>
                {copied ? <CheckCircle2 size={13} className="copy-icon success" /> : <Copy size={13} className="copy-icon" />}
              </div>
              <button className="btn-disconnect" onClick={disconnect}>Disconnect</button>
            </div>
          ) : (
            <button className="btn-connect" onClick={connect} disabled={isConnecting}>
              {isConnecting ? <><Loader2 size={15} className="spin" /> Connecting...</> : <><Wallet size={15} /> Connect Wallet</>}
            </button>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <Zap size={12} />
            Powered by Stellar Soroban Smart Contracts
          </div>
          <h1>Send Money Across Borders<br /><span className="hero-highlight">Instantly. Affordably.</span></h1>
          <p>
            Traditional remittance services charge 5–10% in fees and take days.
            StellarRemit settles in <strong>under 5 seconds</strong> for a fraction of a cent —
            directly on the Stellar blockchain.
          </p>
          <div className="hero-stats">
            <div className="hero-stat">
              <span className="stat-value">~5s</span>
              <span className="stat-label">Settlement</span>
            </div>
            <div className="stat-divider" />
            <div className="hero-stat">
              <span className="stat-value">&lt;$0.001</span>
              <span className="stat-label">Network Fee</span>
            </div>
            <div className="stat-divider" />
            <div className="hero-stat">
              <span className="stat-value">5</span>
              <span className="stat-label">Currencies</span>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="flow-diagram">
            <div className="flow-step sender">
              <div className="flow-icon">
                <Wallet size={22} />
              </div>
              <span className="flow-label">Your Wallet</span>
              <span className="flow-sub">XLM</span>
            </div>
            <div className="flow-connector">
              <div className="connector-line">
                <div className="connector-dot" />
                <div className="connector-dot" />
                <div className="connector-dot" />
              </div>
              <span className="connector-label">Soroban</span>
            </div>
            <div className="flow-step router">
              <div className="flow-icon">
                <Globe2 size={22} />
              </div>
              <span className="flow-label">RemittanceRouter</span>
              <span className="flow-sub">↕ ExchangeLedger</span>
            </div>
            <div className="flow-connector">
              <div className="connector-line">
                <div className="connector-dot" />
                <div className="connector-dot" />
                <div className="connector-dot" />
              </div>
              <span className="connector-label">Settled</span>
            </div>
            <div className="flow-step receiver">
              <div className="flow-icon">
                <DollarSign size={22} />
              </div>
              <span className="flow-label">Recipient</span>
              <span className="flow-sub">USD / INR / EUR…</span>
            </div>
          </div>
        </div>
      </section>

      {/* Global Stats Bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <Activity size={16} className="stat-icon" />
          <span className="stat-label">Total Transfers</span>
          <span className="stat-value-sm">{globalStats.count.toLocaleString()}</span>
        </div>
        <div className="stat-item">
          <TrendingUp size={16} className="stat-icon" />
          <span className="stat-label">Total Volume</span>
          <span className="stat-value-sm">{formatXLM(globalStats.volume)} XLM</span>
        </div>
        <div className="stat-item">
          <Globe2 size={16} className="stat-icon" />
          <span className="stat-label">Network</span>
          <span className="stat-value-sm network-badge">Stellar Testnet</span>
        </div>
        <div className="stat-item">
          <Zap size={16} className="stat-icon" />
          <span className="stat-label">Settlement Time</span>
          <span className="stat-value-sm success-text">~3–5 seconds</span>
        </div>
      </div>

      {/* Error Banner */}
      {uiError && (
        <div className="error-banner" onClick={() => setUiError(null)}>
          <AlertCircle size={17} />
          <span>{uiError}</span>
          <span className="error-dismiss">✕</span>
        </div>
      )}

      {/* Main Content */}
      <main className="main-grid">
        {/* Send Remittance Card */}
        <div className="card send-card">
          <div className="card-header">
            <Send size={20} className="card-icon" />
            <h2>Send Remittance</h2>
          </div>
          <p className="card-desc">
            Enter the amount in XLM. The <strong>RemittanceRouter</strong> contract will call
            the <strong>ExchangeLedger</strong> contract (inter-contract) to convert and record
            your transfer on-chain.
          </p>

          {!address && (
            <div className="connect-prompt">
              <Wallet size={24} />
              <p>Connect your Freighter wallet to send money</p>
              <button className="btn-connect-inline" onClick={connect} disabled={isConnecting}>
                {isConnecting ? <Loader2 size={14} className="spin" /> : <Wallet size={14} />}
                {isConnecting ? 'Connecting...' : 'Connect Freighter'}
              </button>
            </div>
          )}

          <form onSubmit={handleSend} className={!address ? 'form-disabled' : ''}>
            <div className="form-group">
              <label className="form-label">Recipient Stellar Address</label>
              <input
                type="text"
                placeholder="G..."
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                disabled={isSubmitting || !address}
                className="amount-input"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Amount to Send (XLM)</label>
              <div className="amount-input-wrap">
                <input
                  type="number"
                  placeholder="e.g. 100"
                  value={xlmAmount}
                  onChange={e => setXlmAmount(e.target.value)}
                  disabled={isSubmitting || !address}
                  min="1"
                  className="amount-input"
                />
                <span className="input-currency">XLM</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Destination Currency</label>
              <div className="currency-dropdown" onClick={() => address && setDropdownOpen(!dropdownOpen)}>
                <div className="selected-currency">
                  <span className="currency-flag">{selectedCurrency.flag}</span>
                  <span className="currency-name">{selectedCurrency.symbol} — {selectedCurrency.name}</span>
                  <ChevronDown size={16} className={`dropdown-arrow ${dropdownOpen ? 'open' : ''}`} />
                </div>
                {dropdownOpen && (
                  <div className="dropdown-list">
                    {CURRENCIES.map(cur => (
                      <div
                        key={cur.code}
                        className={`dropdown-item ${selectedCurrency.code === cur.code ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setSelectedCurrency(cur); setDropdownOpen(false); }}
                      >
                        <span className="currency-flag">{cur.flag}</span>
                        <span>{cur.symbol}</span>
                        <span className="currency-rate">1 XLM ≈ {cur.rate} {cur.symbol}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Live conversion preview */}
            {preview && (
              <div className="conversion-preview">
                <div className="preview-row">
                  <span className="preview-label">You send</span>
                  <span className="preview-value">{xlmAmount} XLM</span>
                </div>
                <div className="preview-arrow"><ArrowRight size={16} /></div>
                <div className="preview-row">
                  <span className="preview-label">They receive ≈</span>
                  <span className="preview-value highlight">{preview} {selectedCurrency.symbol}</span>
                </div>
                <div className="preview-fee">
                  <Info size={11} />
                  Network fee: &lt;0.001 XLM • Settled via Soroban inter-contract call
                </div>
              </div>
            )}

            <button type="submit" className="btn-primary full-width" disabled={isSubmitting || !address}>
              {isSubmitting
                ? <><Loader2 size={16} className="spin" /> Processing...</>
                : <><Send size={16} /> Send via Stellar</>
              }
            </button>
          </form>

          {/* Transaction Status */}
          {txStatus && (
            <div className={`tx-status ${txStatus.status}`}>
              {txStatus.status === 'pending' && <Loader2 size={20} className="spin" />}
              {txStatus.status === 'success' && <CheckCircle2 size={20} />}
              <div className="tx-details">
                <strong>{txStatus.title}</strong>
                <p>{txStatus.desc}</p>
                {txStatus.hash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${txStatus.hash}`}
                    target="_blank" rel="noreferrer"
                    className="tx-link"
                  >
                    View Transaction <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Stats & Why Stellar */}
        <div className="right-column">
          {/* User Dashboard */}
          {address && (
            <div className="card user-card">
              <div className="card-header">
                <Users size={20} className="card-icon" />
                <h2>Your Transfer History</h2>
                <button
                  className="btn-refresh"
                  onClick={() => fetchStats(address)}
                  disabled={isRefreshing}
                >
                  <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
                </button>
              </div>
              <div className="user-stats-grid">
                <div className="user-stat-box">
                  <span className="user-stat-num">{formatXLM(userStats?.totalSent || 0)}</span>
                  <span className="user-stat-label">XLM Sent</span>
                </div>
                <div className="user-stat-box">
                  <span className="user-stat-num" style={{ color: '#22c55e' }}>
                    ${((userStats?.totalSent || 0) * 0.11).toFixed(2)}
                  </span>
                  <span className="user-stat-label">≈ USD Value</span>
                </div>
              </div>
              <div className="savings-callout">
                <div className="savings-icon">💰</div>
                <div>
                  <strong>Savings vs Western Union</strong>
                  <p>You saved ~${(((userStats?.totalSent || 0) * 0.11) * 0.07).toFixed(2)} (7% avg fee)</p>
                </div>
              </div>
            </div>
          )}

          {/* Why Stellar Card */}
          <div className="card why-card">
            <div className="card-header">
              <Globe2 size={20} className="card-icon" />
              <h2>Why Stellar for Remittances?</h2>
            </div>
            <div className="why-items">
              <div className="why-item">
                <div className="why-icon speed">⚡</div>
                <div>
                  <strong>3–5 Second Finality</strong>
                  <p>Traditional wires take 2–5 days. Stellar settles in seconds.</p>
                </div>
              </div>
              <div className="why-item">
                <div className="why-icon cost">💸</div>
                <div>
                  <strong>Near-Zero Fees</strong>
                  <p>~0.0001 XLM per transaction vs. 5–10% at money transfer services.</p>
                </div>
              </div>
              <div className="why-item">
                <div className="why-icon transparent">🔍</div>
                <div>
                  <strong>Fully Transparent</strong>
                  <p>Every transfer is auditable on-chain. No hidden charges, ever.</p>
                </div>
              </div>
              <div className="why-item">
                <div className="why-icon access">🌍</div>
                <div>
                  <strong>Unbanked Access</strong>
                  <p>1.4 billion unbanked people can receive funds with just a mobile wallet.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Supported Corridors */}
          <div className="card corridors-card">
            <div className="card-header">
              <ArrowRight size={20} className="card-icon" />
              <h2>Supported Corridors</h2>
            </div>
            <div className="corridors-list">
              {CURRENCIES.map(cur => (
                <div key={cur.code} className="corridor-item">
                  <span className="corridor-flag">{cur.flag}</span>
                  <span className="corridor-name">{cur.name}</span>
                  <span className="corridor-rate" style={{ color: cur.color }}>
                    1 XLM = {cur.rate} {cur.symbol}
                  </span>
                </div>
              ))}
            </div>
            <p className="corridors-note">
              <Info size={11} /> Rates simulated on testnet. Production would integrate a Stellar Price Oracle.
            </p>
          </div>
        </div>
      </main>

      {/* Contract Architecture */}
      <section className="architecture-section">
        <h2>How It Works — Inter-Contract Architecture</h2>
        <div className="architecture-grid">
          <div className="arch-step">
            <div className="arch-num">1</div>
            <h3>User Initiates</h3>
            <p>You connect Freighter and call <code>send_remittance()</code> on the RemittanceRouter contract with your XLM amount and destination currency.</p>
          </div>
          <div className="arch-arrow"><ArrowRight size={24} /></div>
          <div className="arch-step">
            <div className="arch-num">2</div>
            <h3>Inter-Contract Call</h3>
            <p>RemittanceRouter calls <code>record_transfer()</code> on the ExchangeLedger contract via <code>env.invoke_contract()</code> — Soroban's inter-contract call mechanism.</p>
          </div>
          <div className="arch-arrow"><ArrowRight size={24} /></div>
          <div className="arch-step">
            <div className="arch-num">3</div>
            <h3>Conversion & Record</h3>
            <p>ExchangeLedger applies the exchange rate, records the converted amount, and returns the result. All atomically in one transaction.</p>
          </div>
          <div className="arch-arrow"><ArrowRight size={24} /></div>
          <div className="arch-step">
            <div className="arch-num">4</div>
            <h3>On-Chain Settled</h3>
            <p>The remittance is settled on Stellar in ~5 seconds. Events are emitted and streamed live to the UI in real-time.</p>
          </div>
        </div>
      </section>

      {/* Live Events Stream */}
      <section className="events-section">
        <div className="card events-card">
          <div className="card-header">
            <Activity size={20} className="card-icon" />
            <h2>Live Remittance Event Stream</h2>
            <span className="live-dot" />
          </div>
          <div className="events-list" ref={eventsRef}>
            {events.length > 0 ? events.map((evt, i) => (
              <div key={i} className="event-item">
                <div className="event-pulse" />
                <div className="event-ledger">Ledger #{evt.ledger}</div>
                <div className="event-type">remittance.sent</div>
                <div className="event-id">{evt.id?.slice(0, 22)}...</div>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${evt.txHash}`}
                  target="_blank" rel="noreferrer"
                  className="event-link"
                >
                  <ExternalLink size={11} />
                </a>
              </div>
            )) : (
              <div className="no-events">
                <Activity size={28} className="no-events-icon" />
                <p>Waiting for remittance events...</p>
                <span>Send a remittance above to see it appear here live.</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-brand">
          <Globe2 size={18} />
          <span>StellarRemit</span>
        </div>
        <p className="footer-desc">
          Decentralized cross-border remittance on Stellar — Level 4 Green Belt
        </p>
        <div className="footer-links">
          <a href={`https://stellar.expert/explorer/testnet/contract/${VAULT_CONTRACT_ID}`} target="_blank" rel="noreferrer">
            Router Contract <ExternalLink size={11} />
          </a>
          <a href={`https://stellar.expert/explorer/testnet/contract/${TOKEN_CONTRACT_ID}`} target="_blank" rel="noreferrer">
            Ledger Contract <ExternalLink size={11} />
          </a>
          <a href="https://github.com/anjay1011/stellar_level4" target="_blank" rel="noreferrer">
            GitHub <ExternalLink size={11} />
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
