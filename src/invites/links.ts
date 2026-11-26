/**
 * Personal friend invite links: https://<webHost>/i/<code>.
 * The host lives in inviteLinks.json so app.config.ts (Associated Domains) reads the same value.
 */
import inviteLinks from './inviteLinks.json';

export const INVITE_WEB_HOST: string = inviteLinks.webHost;
export const INVITE_WEB_ORIGIN = `https://${INVITE_WEB_HOST}`;

/** 8 characters, lower case, no 0/o/1/i/l (matches the database check). */
export const INVITE_CODE = /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/;

export function normalizeInviteCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().toLowerCase();
  return INVITE_CODE.test(code) ? code : null;
}

/** The link people share. */
export const inviteUrl = (code: string) => `${INVITE_WEB_ORIGIN}/i/${code}`;

/** The link as shown in the app (no scheme), e.g. reproyale.vercel.app/i/k7m2qx9p. */
export const inviteLinkLabel = (code: string) => `${INVITE_WEB_HOST}/i/${code}`;

/** Title of the share sheet and the message that goes with the link. */
export const INVITE_SHARE_TITLE = 'Join me on Rep Royale';
