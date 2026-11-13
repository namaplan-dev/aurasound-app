# AuraSound Security Specification

## 1. Data Invariants
1. **Strict Owner Isolation (PII & Backups)**: `/users/{userId}` and `/users/{userId}/backups/{backupId}` are strictly owned by `request.auth.uid == userId`. No user can read, list, create, update, or delete another user's profile or backup.
2. **Verified Email Requirement**: All writes require `request.auth.token.email_verified == true`.
3. **Immutable Ownership & Creation Time**: `ownerId` (or `uid`) and `createdAt` cannot be changed after document creation.
4. **Server Timestamp Integrity**: `createdAt` and `updatedAt` must equal `request.time`.
5. **Bounded Collections & Strict Key Allowlists**: Every document enforces `keys().hasAll(...)` and `keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update, string `.size()` bounds, and list `.size()` caps.

## 2. The "Dirty Dozen" Adversarial Payloads
1. Unauthenticated read of `/users/userA`. -> `PERMISSION_DENIED`
2. Authenticated User B reading `/users/userA` (PII leak test). -> `PERMISSION_DENIED`
3. Authenticated User A listing `/users` collection. -> `PERMISSION_DENIED`
4. User A creating `/users/userA` with `email_verified == false`. -> `PERMISSION_DENIED`
5. User A creating `/users/userA` with a shadow field `isAdmin: true`. -> `PERMISSION_DENIED`
6. User A creating `/users/userA/backups/latest` with `ownerId: "userB"`. -> `PERMISSION_DENIED`
7. User A creating a backup with oversized `backupId` (> 128 chars or invalid chars `../hack`). -> `PERMISSION_DENIED`
8. User A creating a backup with forged `createdAt` in the past instead of `request.time`. -> `PERMISSION_DENIED`
9. User A creating a backup with `eqPresets` exceeding 40 items (Denial of Wallet). -> `PERMISSION_DENIED`
10. User A updating a backup while mutating `ownerId` or `createdAt`. -> `PERMISSION_DENIED`
11. User A updating a backup with an invalid type (`settings: "not-a-map"`). -> `PERMISSION_DENIED`
12. User A updating a backup with an unallowed ghost field (`tier: "vip"`). -> `PERMISSION_DENIED`
