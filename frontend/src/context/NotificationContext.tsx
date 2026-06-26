import React, { createContext, useContext, useState, useCallback } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: NotificationType;
  duration?: number;
}

export interface AlertModal {
  title: string;
  message: string;
  type: NotificationType;
  onClose: () => void;
}

interface NotificationContextProps {
  showToast: (message: string, type?: NotificationType, duration?: number) => void;
  showAlert: (title: string, message: string, type?: NotificationType) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextProps | undefined>(undefined);

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [alert, setAlert] = useState<AlertModal | null>(null);

  const showToast = useCallback((message: string, type: NotificationType = 'info', duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const showAlert = useCallback((title: string, message: string, type: NotificationType = 'info'): Promise<void> => {
    return new Promise<void>((resolve) => {
      setAlert({
        title,
        message,
        type,
        onClose: () => {
          setAlert(null);
          resolve();
        },
      });
    });
  }, []);

  const getIcon = (type: NotificationType) => {
    switch (type) {
      case 'success':
        return 'check_circle';
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
      default:
        return 'info';
    }
  };

  const getTypeColor = (type: NotificationType) => {
    switch (type) {
      case 'success':
        return {
          text: 'text-[#00f4fe]',
          border: 'border-[#00f4fe]/40',
          bg: 'bg-[#00f4fe]/10',
          glow: 'shadow-[0_0_15px_rgba(0,244,254,0.15)]',
          iconColor: '#00f4fe'
        };
      case 'error':
        return {
          text: 'text-[#ff4a5a]',
          border: 'border-[#ff4a5a]/40',
          bg: 'bg-[#ff4a5a]/10',
          glow: 'shadow-[0_0_15px_rgba(255,74,90,0.15)]',
          iconColor: '#ff4a5a'
        };
      case 'warning':
        return {
          text: 'text-[#f59e0b]',
          border: 'border-[#f59e0b]/40',
          bg: 'bg-[#f59e0b]/10',
          glow: 'shadow-[0_0_15px_rgba(245,158,11,0.15)]',
          iconColor: '#f59e0b'
        };
      case 'info':
      default:
        return {
          text: 'text-[#fface8]',
          border: 'border-[#fface8]/40',
          bg: 'bg-[#fface8]/10',
          glow: 'shadow-[0_0_15px_rgba(255,172,232,0.15)]',
          iconColor: '#fface8'
        };
    }
  };

  return (
    <NotificationContext.Provider value={{ showToast, showAlert }}>
      {children}

      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 max-w-md w-full pointer-events-none px-4 md:px-0">
        {toasts.map((toast) => {
          const colors = getTypeColor(toast.type);
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl glass-panel ${colors.border} ${colors.glow} animate-slide-in relative overflow-hidden`}
              style={{
                background: 'rgba(15, 18, 36, 0.85)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
              }}
            >
              {/* Type Accent Bar */}
              <div 
                className="absolute left-0 top-0 bottom-0 w-1" 
                style={{ backgroundColor: colors.iconColor }}
              />
              
              <span className={`material-symbols-outlined ${colors.text} select-none mt-0.5`}>
                {getIcon(toast.type)}
              </span>
              
              <div className="flex-grow pr-4">
                <p className="text-xs text-white font-medium leading-relaxed">{toast.message}</p>
              </div>

              <button
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="text-white/40 hover:text-white transition-colors border-none bg-transparent cursor-pointer p-0 select-none flex items-center justify-center self-start"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>

              {/* Progress Bar timer animation */}
              <div 
                className="absolute bottom-0 left-0 right-0 h-[2px] opacity-40"
                style={{
                  backgroundColor: colors.iconColor,
                  animation: `shrink-width ${toast.duration || 4000}ms linear forwards`
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Custom Alert Modal */}
      {alert && (
        <div className="modal-overlay z-[99999] animate-fade-in">
          <div 
            className="glass-card rounded-2xl p-6 md:p-8 max-w-md w-full border border-white/10 relative overflow-hidden flex flex-col items-center text-center shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
            style={{
              background: 'rgba(11, 14, 20, 0.95)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            {/* Ambient Background Glow matching alert type */}
            <div 
              className="absolute -top-16 -left-16 w-36 h-36 rounded-full opacity-25 blur-[40px] pointer-events-none"
              style={{ backgroundColor: getTypeColor(alert.type).iconColor }}
            />

            {/* Glowing Icon Container */}
            <div 
              className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${getTypeColor(alert.type).bg} border ${getTypeColor(alert.type).border}`}
            >
              <span 
                className="material-symbols-outlined text-2xl"
                style={{ color: getTypeColor(alert.type).iconColor }}
              >
                {getIcon(alert.type)}
              </span>
            </div>

            <h3 className="text-lg font-bold text-white mb-2 tracking-tight">
              {alert.title}
            </h3>
            
            <p className="text-xs text-[#cfc2d7] leading-relaxed mb-6 whitespace-pre-wrap">
              {alert.message}
            </p>

            <button
              onClick={alert.onClose}
              className="w-full btn-primary py-3 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
}
