/**
 * Local Storage Service for Emergency Sessions
 * Persists transcriptions, translations, and extracted symptoms
 */

export interface EmergencySession {
  id: string;
  timestamp: string;
  originalTranscript: string;
  englishTranslation: string;
  detectedLanguage: string;
  symptomsExtracted: {
    key: string;
    value: string;
    critical: boolean;
  }[];
  action: 'dispatched' | 'cancelled' | 'pending';
  confidenceScore: number;
  durationSeconds?: number;
}

const STORAGE_KEY = 'golden_hour_sessions';

// Generate a unique ID
function generateId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Get all sessions from localStorage
export function getAllSessions(): EmergencySession[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error reading sessions:', error);
    return [];
  }
}

// Save a new session
export function saveSession(session: Omit<EmergencySession, 'id' | 'timestamp'>): EmergencySession {
  const newSession: EmergencySession = {
    ...session,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };

  const sessions = getAllSessions();
  sessions.unshift(newSession); // Add to beginning (most recent first)

  // Keep only last 50 sessions to avoid localStorage limits
  const trimmedSessions = sessions.slice(0, 50);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedSessions));
  } catch (error) {
    console.error('Error saving session:', error);
  }

  return newSession;
}

// Get a single session by ID
export function getSession(id: string): EmergencySession | null {
  const sessions = getAllSessions();
  return sessions.find(s => s.id === id) || null;
}

// Update a session's action status
export function updateSessionAction(id: string, action: EmergencySession['action']): void {
  const sessions = getAllSessions();
  const index = sessions.findIndex(s => s.id === id);

  if (index !== -1) {
    sessions[index].action = action;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (error) {
      console.error('Error updating session:', error);
    }
  }
}

// Clear all sessions (for testing)
export function clearAllSessions(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// Get session stats
export function getSessionStats(): {
  total: number;
  dispatched: number;
  cancelled: number;
  criticalSymptoms: number;
} {
  const sessions = getAllSessions();
  return {
    total: sessions.length,
    dispatched: sessions.filter(s => s.action === 'dispatched').length,
    cancelled: sessions.filter(s => s.action === 'cancelled').length,
    criticalSymptoms: sessions.filter(s =>
      s.symptomsExtracted.some(sym => sym.critical)
    ).length,
  };
}
