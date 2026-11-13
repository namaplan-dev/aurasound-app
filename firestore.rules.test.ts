/**
 * Dirty Dozen & Rules Verification Suite for AuraSound Firestore Security Rules.
 * Documents the 12 adversarial payloads tested against firestore.rules.
 */
export const DIRTY_DOZEN_PAYLOADS = [
  { id: 1, name: 'Unauthenticated user profile read', path: '/users/userA', operation: 'get', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Cross-user PII read attempt', path: '/users/userA', authUid: 'userB', operation: 'get', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'User collection scraping list', path: '/users', authUid: 'userA', operation: 'list', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Unverified email profile create', path: '/users/userA', authUid: 'userA', emailVerified: false, operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Shadow admin field injection', path: '/users/userA', payload: { uid: 'userA', isAdmin: true }, operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Spoofed backup ownerId', path: '/users/userA/backups/latest', payload: { ownerId: 'userB' }, operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Invalid path traversal backupId', path: '/users/userA/backups/..%2Fhack', authUid: 'userA', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Forged client timestamp on create', path: '/users/userA/backups/latest', payload: { createdAt: '2020-01-01T00:00:00Z' }, operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Denial-of-wallet oversized eqPresets array (>40)', path: '/users/userA/backups/latest', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Mutating immutable ownerId/createdAt on update', path: '/users/userA/backups/latest', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Type poisoning on settings map', path: '/users/userA/backups/latest', payload: { settings: 'corrupted' }, operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Ghost field on update', path: '/users/userA/backups/latest', payload: { tier: 'vip' }, operation: 'update', expected: 'PERMISSION_DENIED' },
];
