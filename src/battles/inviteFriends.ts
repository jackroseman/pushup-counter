import { Share } from 'react-native';

/**
 * Invite friends (frame 28): the standard share sheet with a plain message.
 * There is no personal invite-link API (plan §5 #13), so the message carries the user's
 * @username, which friends can search for, plus an install link when there is one.
 * The App Store listing is not public yet, so `INSTALL_URL` stays empty until there is a
 * link that works for people outside the beta.
 */
export const INSTALL_URL: string | null = null;

export const INVITE_TITLE = 'Join me on Rep Royale';

export function inviteFriendsMessage(username: string | null | undefined, url: string | null = INSTALL_URL): string {
  const handle = username?.trim().replace(/^@/, '');
  const add = handle ? ` Add me: @${handle}` : '';
  return `${INVITE_TITLE}.${add}${url ? `\n${url}` : ''}`;
}

/** Opens the share sheet. Cancelling is not an error. */
export async function shareInvite(username: string | null | undefined): Promise<void> {
  try {
    await Share.share({ title: INVITE_TITLE, message: inviteFriendsMessage(username) }, { subject: INVITE_TITLE });
  } catch {
    // The share sheet could not open; there is nothing useful to show.
  }
}
