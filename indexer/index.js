import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';

function extractTokenFromTx(envelopeXdrBase64, targetContractId) {
  try {
    let envelope;
    if (typeof envelopeXdrBase64 === 'string') {
      envelope = xdr.TransactionEnvelope.fromXDR(envelopeXdrBase64, 'base64');
    } else {
      envelope = envelopeXdrBase64;
    }
    let tx;
    const type = envelope.switch().name;
    if (type === 'envelopeTypeTx') {
      tx = envelope.v1().tx();
    } else if (type === 'envelopeTypeTxV0') {
      tx = envelope.v0().tx();
    } else if (type === 'envelopeTypeTxFeeBump') {
      tx = envelope.feeBump().tx().innerTx().v1().tx();
    } else {
      return null;
    }

    for (const op of tx.operations()) {
      const body = op.body();
      if (body.switch().name === 'invokeHostFunction') {
        const invokeOp = body.invokeHostFunctionOp();
        const hostFn = invokeOp.hostFunction();
        if (hostFn.switch().name === 'hostFunctionTypeInvokeContract') {
          const invokeContract = hostFn.invokeContract();
          
          const contractId = scValToNative(xdr.ScVal.scvAddress(invokeContract.contractAddress()));
          
          if (contractId === targetContractId) {
            const args = invokeContract.args();
            if (args && args.length > 0) {
              const arg0Native = scValToNative(args[0]);
              const arg1Native = args.length > 1 ? scValToNative(args[1]) : null;

              if (arg1Native && typeof arg1Native === 'string' && (arg1Native.startsWith('C') || arg1Native.startsWith('G'))) {
                return arg1Native;
              } else if (typeof arg0Native === 'string' && (arg0Native.startsWith('C') || arg0Native.startsWith('G'))) {
                return arg0Native;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Error extracting token from TX:", err);
  }
  return null;
}
import { ChannelsClient } from '@openzeppelin/relayer-plugin-channels';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Zero-dependency .env parser to check multiple directories
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '../frontend/.env'),
    path.join(__dirname, '.env'),
    path.join(__dirname, '../.env')
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
          const cleanLine = line.split('#')[0].trim();
          if (!cleanLine) return;
          const match = cleanLine.match(/^([\w.-]+)\s*=\s*(.*)?$/);
          if (match) {
            const key = match[1];
            let val = match[2] || '';
            if (val.startsWith('"') && val.endsWith('"')) {
              val = val.substring(1, val.length - 1);
            } else if (val.startsWith("'") && val.endsWith("'")) {
              val = val.substring(1, val.length - 1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        });
      } catch (e) {
        console.error(`Failed to read .env at ${envPath}:`, e);
      }
    }
  }
}

// Load environment variables
loadEnv();

const DEPLOYED_PATH = path.join(__dirname, '../frontend/src/config/deployed.json');
const DB_PATH = path.join(__dirname, 'indexer_db.json');
const RPC_URL = "https://soroban-testnet.stellar.org";
const PORT = process.env.PORT || 8123;

const app = express();
app.use(cors());
app.use(express.json());

// Initialize OpenZeppelin Channels client if API key is provided
let relayerClient = null;
const apiKey = process.env.OPENZEPPELIN_CHANNELS_API_KEY || process.env.CHANNELS_API_KEY;
if (apiKey) {
  try {
    relayerClient = new ChannelsClient({
      baseUrl: "https://channels.openzeppelin.com/testnet",
      apiKey: apiKey
    });
    console.log("🚀 OpenZeppelin Channels Relayer Client initialized for Soroban Testnet!");
  } catch (e) {
    console.error("❌ Failed to initialize OpenZeppelin Channels Client:", e);
  }
} else {
  console.log("⚠️ OPENZEPPELIN_CHANNELS_API_KEY is not set. Relayer transaction submissions will return instructions.");
}

// Initialize database
let db = {
  lastSyncedLedger: 0,
  events: [],
  contractId: ""
};

function loadDb() {
  if (fs.existsSync(DB_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      db = { ...db, ...data };
      console.log(`Loaded database. ${db.events.length} events indexed. Last synced ledger: ${db.lastSyncedLedger}`);
    } catch (e) {
      console.error("Failed to parse database file, resetting:", e);
    }
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error("Failed to save database:", e);
  }
}

// Load config
let whisperContractId = "";
function loadConfig() {
  if (fs.existsSync(DEPLOYED_PATH)) {
    try {
      const config = JSON.parse(fs.readFileSync(DEPLOYED_PATH, 'utf8'));
      if (config.whisperContractId && config.whisperContractId !== db.contractId) {
        console.log(`Contract ID changed from "${db.contractId}" to "${config.whisperContractId}". Resetting indexer DB.`);
        db.contractId = config.whisperContractId;
        db.lastSyncedLedger = 0;
        db.events = [];
        saveDb();
      }
      whisperContractId = config.whisperContractId;
    } catch (e) {
      console.error("Failed to parse deployed.json:", e);
    }
  }
  return whisperContractId;
}

const server = new rpc.Server(RPC_URL);

function sanitizeEventForDb(ev) {
  const sanitized = {
    id: ev.id,
    type: ev.type,
    ledger: ev.ledger,
    ledgerClosedAt: ev.ledgerClosedAt,
    contractId: whisperContractId,
    txHash: ev.txHash
  };

  // Convert topic array of ScVal to array of base64 strings
  if (Array.isArray(ev.topic)) {
    sanitized.topic = ev.topic.map(t => {
      if (t && typeof t === 'object' && typeof t.toXDR === 'function') {
        return t.toXDR("base64");
      }
      return typeof t === 'string' ? t : String(t);
    });
  } else {
    sanitized.topic = [];
  }

  // Convert value ScVal to base64 string
  if (ev.value) {
    if (typeof ev.value === 'object' && typeof ev.value.toXDR === 'function') {
      sanitized.value = ev.value.toXDR("base64");
    } else if (ev.value && ev.value.xdr) {
      sanitized.value = ev.value.xdr;
    } else {
      sanitized.value = typeof ev.value === 'string' ? ev.value : String(ev.value);
    }
  }

  return sanitized;
}

async function indexEvents() {
  loadConfig();
  if (!whisperContractId) {
    console.log("No whisperContractId found in deployed.json. Retrying in 5s...");
    setTimeout(indexEvents, 5000);
    return;
  }

  try {
    const latestLedgerRes = await server.getLatestLedger();
    const latestLedger = latestLedgerRes.sequence;

    let startLedger = db.lastSyncedLedger + 1;
    if (db.lastSyncedLedger === 0) {
      // If never synced, start 120,000 ledgers back or at oldest available
      startLedger = Math.max(1, latestLedger - 120000);
    }

    if (startLedger > latestLedger) {
      // Already caught up
      setTimeout(indexEvents, 5000);
      return;
    }

    console.log(`Indexing events for contract ${whisperContractId} from ledger ${startLedger} to ${latestLedger}...`);

    let eventsFetched = [];
    let cursor = undefined;
    let lastCursor = undefined;
    let currentStart = startLedger;

    // Fetch in chunks/pages
    while (true) {
      const request = {
        limit: 100,
        filters: [{
          contractIds: [whisperContractId],
          type: "contract"
        }]
      };
      if (cursor) {
        request.cursor = cursor;
      } else {
        request.startLedger = currentStart;
      }

      let response;
      try {
        response = await server.getEvents(request);
      } catch (err) {
        const errorMsg = err.message || String(err);
        // Handle out-of-range start ledger
        const match = errorMsg.match(/range:\s*(\d+)/i) || errorMsg.match(/(\d+)\s*-\s*(\d+)/);
        if (match && match[1]) {
          const minLedger = parseInt(match[1], 10);
          if (minLedger > currentStart) {
            console.log(`Adjusting startLedger from ${currentStart} to ${minLedger}`);
            currentStart = minLedger;
            continue;
          }
        }
        throw err;
      }

      if (response.events && response.events.length > 0) {
        eventsFetched.push(...response.events);
      }

      if (!response.cursor || response.cursor === lastCursor) {
        break;
      }
      lastCursor = response.cursor;
      cursor = response.cursor;
    }

    // Filter duplicates and append
    if (eventsFetched.length > 0) {
      const existingIds = new Set(db.events.map(e => e.id));
      let newCount = 0;
      for (const ev of eventsFetched) {
        if (!existingIds.has(ev.id)) {
          const sanitized = sanitizeEventForDb(ev);
          try {
            const txDetails = await server.getTransaction(ev.txHash);
            if (txDetails && txDetails.envelopeXdr) {
              const tokenAddress = extractTokenFromTx(txDetails.envelopeXdr, whisperContractId);
              if (tokenAddress) {
                sanitized.tokenAddress = tokenAddress;
              }
            }
          } catch (txErr) {
            console.error(`Failed to fetch TX details for hash ${ev.txHash}:`, txErr);
          }
          db.events.push(sanitized);
          newCount++;
        }
      }
      console.log(`Found ${eventsFetched.length} events. Added ${newCount} new events to database.`);
    }

    db.lastSyncedLedger = latestLedger;
    saveDb();
  } catch (e) {
    console.error("Error during indexing:", e);
  }

  // Poll again in 5 seconds
  setTimeout(indexEvents, 5000);
}

// API Routes
app.get('/api/events', (req, res) => {
  loadConfig(); // Refresh config in case of redeployment
  res.json({
    contractId: whisperContractId,
    lastSyncedLedger: db.lastSyncedLedger,
    events: db.events
  });
});

app.post('/api/reset', (req, res) => {
  console.log("Manual reset requested.");
  db.lastSyncedLedger = 0;
  db.events = [];
  saveDb();
  res.json({ success: true });
});

app.post('/api/relay', async (req, res) => {
  const { func, auth } = req.body;
  if (!func) {
    return res.status(400).json({ error: "Missing 'func' parameter (host function XDR)." });
  }

  const relayApiKey = process.env.RELAY_API_KEY;
  if (relayApiKey) {
    const requestKey = req.headers['x-api-key'];
    if (!requestKey || requestKey !== relayApiKey) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing API key. Provide x-api-key header." });
    }
  }

  const activeApiKey = process.env.OPENZEPPELIN_CHANNELS_API_KEY || process.env.CHANNELS_API_KEY;
  if (!activeApiKey) {
    return res.status(400).json({
      error: "Relayer API Key Not Configured",
      details: "To use the shielded relayer, please obtain a free Stellar Channels API Key by visiting https://channels.openzeppelin.com/testnet/gen, then add OPENZEPPELIN_CHANNELS_API_KEY=your_key to your frontend/.env file and restart the application."
    });
  }

  if (!relayerClient) {
    try {
      relayerClient = new ChannelsClient({
        baseUrl: "https://channels.openzeppelin.com/testnet",
        apiKey: activeApiKey
      });
    } catch (e) {
      return res.status(500).json({ error: "Failed to initialize OpenZeppelin Channels Client", details: e.message });
    }
  }

  try {
    console.log("⚡ Relaying Soroban transaction via OpenZeppelin Stellar Channels...");
    const result = await relayerClient.submitSorobanTransaction({
      func,
      auth: auth || []
    });
    console.log(`✅ Relay successful! Transaction Hash: ${result.hash}`);
    return res.json({ success: true, hash: result.hash });
  } catch (err) {
    console.error("❌ Relay submission failed:", err);
    return res.status(500).json({
      error: "OpenZeppelin Channels relay failed",
      details: err.message || String(err)
    });
  }
});

async function migrateDbEvents() {
  loadConfig();
  if (!whisperContractId) return;
  let updated = false;
  for (const ev of db.events) {
    if ((!ev.tokenAddress || !ev.tokenAddress.startsWith('C')) && ev.txHash) {
      try {
        console.log(`[Migration] Fetching token address for event ${ev.id}...`);
        const txDetails = await server.getTransaction(ev.txHash);
        if (txDetails && txDetails.envelopeXdr) {
          const tokenAddress = extractTokenFromTx(txDetails.envelopeXdr, whisperContractId);
          if (tokenAddress) {
            ev.tokenAddress = tokenAddress;
            updated = true;
          }
        }
      } catch (err) {
        console.error(`[Migration] Failed to migrate event ${ev.id}:`, err);
      }
    }
  }
  if (updated) {
    saveDb();
    console.log("[Migration] Database successfully migrated with token addresses.");
  }
}

// Start server and indexer
loadDb();
app.listen(PORT, () => {
  console.log(`Stellar Whisper Indexer Server listening on port ${PORT}`);
  migrateDbEvents().then(() => {
    indexEvents();
  });
});
