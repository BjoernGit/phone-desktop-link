import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSessionState,
  roomName,
  coerceSessionId,
  inRoom,
  findSocketsByUuid,
} from './sessionManager.js';

describe('sessionManager', () => {
  describe('getSessionState', () => {
    it('creates new session state with empty sets', () => {
      const state = getSessionState('new-session');

      expect(state).toHaveProperty('approved');
      expect(state).toHaveProperty('rejected');
      expect(state).toHaveProperty('pending');
      expect(state.approved).toBeInstanceOf(Set);
      expect(state.rejected).toBeInstanceOf(Set);
      expect(state.pending).toBeInstanceOf(Set);
      expect(state.approved.size).toBe(0);
      expect(state.rejected.size).toBe(0);
      expect(state.pending.size).toBe(0);
    });

    it('returns existing session state', () => {
      const state1 = getSessionState('existing-session');
      state1.approved.add('user-1');

      const state2 = getSessionState('existing-session');

      expect(state2).toBe(state1);
      expect(state2.approved.has('user-1')).toBe(true);
    });

    it('creates separate states for different sessions', () => {
      const state1 = getSessionState('session-a');
      const state2 = getSessionState('session-b');

      state1.approved.add('user-a');
      state2.approved.add('user-b');

      expect(state1.approved.has('user-a')).toBe(true);
      expect(state1.approved.has('user-b')).toBe(false);
      expect(state2.approved.has('user-b')).toBe(true);
      expect(state2.approved.has('user-a')).toBe(false);
    });

    it('state changes persist across calls', () => {
      const sessionId = 'persistent-session';
      const state1 = getSessionState(sessionId);

      state1.approved.add('user-1');
      state1.rejected.add('user-2');
      state1.pending.add('user-3');

      const state2 = getSessionState(sessionId);

      expect(state2.approved.has('user-1')).toBe(true);
      expect(state2.rejected.has('user-2')).toBe(true);
      expect(state2.pending.has('user-3')).toBe(true);
    });
  });

  describe('roomName', () => {
    it('generates room name with prefix', () => {
      expect(roomName('test-session')).toBe('session:test-session');
    });

    it('handles session IDs with special characters', () => {
      expect(roomName('session_123-abc')).toBe('session:session_123-abc');
    });

    it('handles empty session ID', () => {
      expect(roomName('')).toBe('session:');
    });

    it('generates consistent room names', () => {
      const sessionId = 'consistent-test';
      expect(roomName(sessionId)).toBe(roomName(sessionId));
    });
  });

  describe('coerceSessionId', () => {
    it('returns string as-is', () => {
      expect(coerceSessionId('test-session')).toBe('test-session');
    });

    it('converts number to string', () => {
      expect(coerceSessionId(12345)).toBe('12345');
    });

    it('returns empty string for null', () => {
      expect(coerceSessionId(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(coerceSessionId(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(coerceSessionId('')).toBe('');
    });

    it('converts object to string', () => {
      const obj = { toString: () => 'custom-session' };
      expect(coerceSessionId(obj)).toBe('custom-session');
    });

    it('converts truthy boolean to string', () => {
      expect(coerceSessionId(true)).toBe('true');
    });

    it('returns empty string for false (falsy)', () => {
      // false is falsy, so coerceSessionId treats it like null/undefined
      expect(coerceSessionId(false)).toBe('');
    });

    it('preserves special characters in string', () => {
      expect(coerceSessionId('test_session-123')).toBe('test_session-123');
    });
  });

  describe('inRoom', () => {
    it('returns true when socket is in session room', () => {
      const mockSocket = {
        rooms: new Set(['session:test-session', 'other-room']),
      };

      expect(inRoom(mockSocket, 'test-session')).toBe(true);
    });

    it('returns false when socket is not in session room', () => {
      const mockSocket = {
        rooms: new Set(['other-room']),
      };

      expect(inRoom(mockSocket, 'test-session')).toBe(false);
    });

    it('returns false when socket has no rooms', () => {
      const mockSocket = {
        rooms: new Set(),
      };

      expect(inRoom(mockSocket, 'test-session')).toBe(false);
    });

    it('checks exact room match', () => {
      const mockSocket = {
        rooms: new Set(['session:test-session-1']),
      };

      expect(inRoom(mockSocket, 'test-session')).toBe(false);
      expect(inRoom(mockSocket, 'test-session-1')).toBe(true);
    });
  });

  describe('findSocketsByUuid', () => {
    it('finds sockets matching session and UUID', () => {
      const mockSocket1 = {
        id: 'socket-1',
        data: { sessionId: 'test-session', clientUuid: 'uuid-123' },
      };
      const mockSocket2 = {
        id: 'socket-2',
        data: { sessionId: 'test-session', clientUuid: 'uuid-123' },
      };
      const mockSocket3 = {
        id: 'socket-3',
        data: { sessionId: 'test-session', clientUuid: 'uuid-456' },
      };

      const mockIo = {
        sockets: {
          sockets: new Map([
            ['socket-1', mockSocket1],
            ['socket-2', mockSocket2],
            ['socket-3', mockSocket3],
          ]),
        },
      };

      const result = findSocketsByUuid(mockIo, 'test-session', 'uuid-123');

      expect(result).toHaveLength(2);
      expect(result).toContain(mockSocket1);
      expect(result).toContain(mockSocket2);
      expect(result).not.toContain(mockSocket3);
    });

    it('returns empty array when no sockets match', () => {
      const mockSocket = {
        id: 'socket-1',
        data: { sessionId: 'other-session', clientUuid: 'other-uuid' },
      };

      const mockIo = {
        sockets: {
          sockets: new Map([['socket-1', mockSocket]]),
        },
      };

      const result = findSocketsByUuid(mockIo, 'test-session', 'uuid-123');

      expect(result).toHaveLength(0);
    });

    it('filters by both session and UUID', () => {
      const mockSocket1 = {
        id: 'socket-1',
        data: { sessionId: 'test-session', clientUuid: 'uuid-123' },
      };
      const mockSocket2 = {
        id: 'socket-2',
        data: { sessionId: 'other-session', clientUuid: 'uuid-123' },
      };
      const mockSocket3 = {
        id: 'socket-3',
        data: { sessionId: 'test-session', clientUuid: 'other-uuid' },
      };

      const mockIo = {
        sockets: {
          sockets: new Map([
            ['socket-1', mockSocket1],
            ['socket-2', mockSocket2],
            ['socket-3', mockSocket3],
          ]),
        },
      };

      const result = findSocketsByUuid(mockIo, 'test-session', 'uuid-123');

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockSocket1);
    });

    it('handles empty socket map', () => {
      const mockIo = {
        sockets: {
          sockets: new Map(),
        },
      };

      const result = findSocketsByUuid(mockIo, 'test-session', 'uuid-123');

      expect(result).toHaveLength(0);
    });
  });
});
