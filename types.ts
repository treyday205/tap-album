
export enum UserRole {
  ARTIST = 'ARTIST',
  ADMIN = 'ADMIN'
}

export interface User {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface Project {
  projectId: string;
  ownerUserId: string;
  slug: string;
  title: string;
  artistName: string;
  coverImageUrl: string;
  coverRef?: string | null;
  coverKey?: string | null;
  coverMime?: string | null;
  coverUrl?: string | null;
  coverUrlExpiresAt?: number | null;
  coverPath?: string | null;
  coverSignedUrl?: string | null;
  trackCount?: number;
  pinUnlockCount?: number;
  pinUnlockLimit?: number;
  pinUnlockRemaining?: number;
  pinActiveCount?: number;
  pinActiveLimit?: number;
  pinActiveRemaining?: number;
  ticketsUrl?: string;
  merchUrl?: string;
  // Social Media Links
  instagramUrl?: string;
  twitterUrl?: string;
  tiktokUrl?: string;
  youtubeUrl?: string;
  facebookUrl?: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  // Verification Info
  isPrivate?: boolean;
  emailGateEnabled?: boolean;
  // Activation Security
  activationPins?: string[];
  usedPins?: string[];
  // Security V2 (config-only; server enforcement optional)
  securityMode?: 'open' | 'email' | 'pin' | 'nfc' | 'private';
  securityUnlockLimit?: number;
  securityUnlocksPerEmail?: number;
  securityActivePinLimit?: number;
  securityPinRequired?: boolean;
  // Distribution V2 (UI-only controls)
  distributionMode?: 'open' | 'limited' | 'code' | 'tap';
  distributionStatus?: 'live' | 'paused' | 'closed';
}

export interface Track {
  trackId: string;
  projectId: string;
  title: string;
  mp3Url: string;
  spotifyUrl?: string;
  trackUrl?: string;
  audioKey?: string | null;
  storageBucket?: string;
  audioUrl?: string;
  audioUrlExpiresAt?: number | null;
  audioPath?: string;
  storagePath?: string;
  clearAudioOnSync?: boolean;
  trackNo?: number;
  artworkUrl?: string;
  sortOrder: number;
  createdAt: string;
}

export enum LinkCategory {
  STREAMING = 'STREAMING',
  OTHER = 'OTHER'
}

export interface ProjectLink {
  linkId: string;
  projectId: string;
  label: string;
  url: string;
  category: LinkCategory;
  sortOrder: number;
}

export enum EventType {
  VIEW = 'VIEW',
  TRACK_PLAY = 'TRACK_PLAY',
  LINK_CLICK = 'LINK_CLICK',
  WALLET_ADD = 'WALLET_ADD',
  ACTIVATION_SUCCESS = 'ACTIVATION_SUCCESS',
  ACTIVATION_FAILED = 'ACTIVATION_FAILED'
}

export interface Event {
  eventId: string;
  projectId: string;
  eventType: EventType;
  label: string; // track title or link label
  createdAt: string;
}
