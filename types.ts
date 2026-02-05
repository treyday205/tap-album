
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
}

export interface Track {
  trackId: string;
  projectId: string;
  title: string;
  mp3Url: string;
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
