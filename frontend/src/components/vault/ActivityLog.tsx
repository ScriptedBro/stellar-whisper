import type { ActivityLog as ActivityLogType } from '../../types';
import { useNotification } from '../../context/NotificationContext';

interface ActivityLogProps {
  logs: ActivityLogType[];
}

export function ActivityLog({ logs }: ActivityLogProps) {
  const { showToast } = useNotification();
  return (
    <div className="col-span-12 lg:col-span-7 glass-panel rounded-lg p-6 md:p-8 glass-inner-stroke">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-bold text-lg text-white">Recent Activity Log</h3>
        <span 
          onClick={() => {
            console.log("Current activity logs:", logs);
            showToast("Logs exported to console.", "success");
          }} 
          className="text-[10px] text-[#cfc2d7] cursor-pointer hover:text-white transition-colors tracking-widest font-mono"
        >
          EXPORT LOGS
        </span>
      </div>
      
      <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
        {logs.map((log) => {
          const isCredit = log.type === 'deposit' || 
                           (log.type === 'transfer' && (
                             log.recipient?.toLowerCase().includes('received') || 
                             log.details?.toLowerCase().includes('received')
                           ));
          
          const isWithdrawal = log.type === 'transfer' && (
            log.recipient?.toLowerCase().includes('withdrawn') ||
            log.details?.toLowerCase().includes('withdrawal')
          );

          return (
            <div key={log.id} className="flex items-center justify-between p-4 rounded bg-white/3 border border-white/5 group hover:bg-white/8 transition-all">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded flex items-center justify-center ${
                  log.type === 'deposit' ? 'bg-[#8a2be2]/10 text-[#dcb8ff]' : 
                  log.type === 'transfer' ? (
                    isCredit ? 'bg-green-500/10 text-green-400' : 'bg-[#00f4fe]/10 text-[#00f4fe]'
                  ) : 
                  'bg-[#fface8]/10 text-[#fface8]'
                }`}>
                  <span className="material-symbols-outlined">
                    {log.type === 'deposit' ? 'arrow_downward' : 
                     log.type === 'transfer' ? (
                       isCredit ? 'arrow_downward' : 
                       isWithdrawal ? 'publish' : 'arrow_upward'
                     ) : 
                     'verified'}
                  </span>
                </div>
                <div>
                  <p className="font-bold text-sm text-white">
                    {log.type === 'deposit' && "Shield Asset Deposit"}
                    {log.type === 'transfer' && (
                      isWithdrawal ? "Shielded Withdrawal" :
                      isCredit ? "Shielded Receive" : "Shielded Send"
                    )}
                    {log.type === 'compliance' && "ZK Compliance Report"}
                  </p>
                  <p className="text-[10px] text-[#cfc2d7]">
                    {log.type === 'transfer' && log.recipient && (
                      isCredit ? `From ${log.recipient.includes('Received') ? 'Shielded Sender' : log.recipient} • ` : `To ${log.recipient} • `
                    )}
                    {log.timestamp}
                  </p>
                </div>
              </div>
              
              <div className="text-right flex items-center gap-4">
                <div>
                  {log.amount && (
                    <p className={`font-bold text-sm ${
                      log.status === 'failed' ? 'text-red-400' : 
                      isCredit ? 'text-green-400' : 'text-white'
                    }`}>
                      {isCredit ? '+' : '-'}{log.amount.toFixed(2)} {log.asset || 'USDC'}
                    </p>
                  )}
                  <p className="text-[10px] text-[#00dce5] font-bold uppercase tracking-wider">
                    {log.status === 'success' && 'CONFIRMED'}
                    {log.status === 'verified' && 'VERIFIED'}
                    {log.status === 'failed' && 'FAILED'}
                  </p>
                </div>
              {log.txHash ? (
                <a 
                  href={`https://stellar.expert/explorer/testnet/tx/${log.txHash}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 glass-action rounded text-[10px] font-bold border border-white/10 transition-all text-white no-underline flex items-center gap-1"
                >
                  Explore
                  <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                </a>
              ) : (
                <button className="px-3.5 py-1.5 glass-action rounded text-[10px] font-bold border border-white/10 transition-all text-[#cfc2d7] cursor-pointer">
                  View Proof
                </button>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
