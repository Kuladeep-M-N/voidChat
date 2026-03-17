import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface SystemConfig {
  safeMode: boolean;
  disableConfessions: boolean;
  disableDebates: boolean;
  disableVoiceRooms: boolean;
  disableShoutouts: boolean;
  disablePolls: boolean;
  disableQnA: boolean;
}

interface SystemConfigContextType {
  config: SystemConfig;
  loading: boolean;
  updateConfig: (updates: Partial<SystemConfig>) => Promise<void>;
}

const defaultConfig: SystemConfig = {
  safeMode: false,
  disableConfessions: false,
  disableDebates: false,
  disableVoiceRooms: false,
  disableShoutouts: false,
  disablePolls: false,
  disableQnA: false,
};

const SystemConfigContext = createContext<SystemConfigContextType>({
  config: defaultConfig,
  loading: true,
  updateConfig: async () => {},
});

export const SystemConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SystemConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const configRef = doc(db, 'system_config', 'global');

    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      if (snapshot.exists()) {
        setConfig(snapshot.data() as SystemConfig);
      } else {
        // Initialize if doesn't exist
        setDoc(configRef, defaultConfig);
        setConfig(defaultConfig);
      }
      setLoading(false);
    }, (error) => {
      console.error("System config listener error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const updateConfig = async (updates: Partial<SystemConfig>) => {
    const configRef = doc(db, 'system_config', 'global');
    try {
      await updateDoc(configRef, updates);
    } catch (error) {
      console.error("Error updating system config:", error);
      throw error;
    }
  };

  return (
    <SystemConfigContext.Provider value={{ config, loading, updateConfig }}>
      {children}
    </SystemConfigContext.Provider>
  );
};

export const useSystemConfig = () => useContext(SystemConfigContext);
