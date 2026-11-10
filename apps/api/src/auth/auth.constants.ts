import { SetMetadata } from '@nestjs/common';

export const SESSION_COOKIE = 'aba_session';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as reachable without logging in. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface SessionUser {
  id: string;
  username: string;
}
