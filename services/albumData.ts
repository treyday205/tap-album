import { Api } from './api';

export interface AlbumLinks {
  merch?: string;
  tickets?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
}

export interface AlbumActionCard {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  price?: string;
  date?: string;
  location?: string;
  image?: string;
  ctaLabel?: string;
  url?: string;
}

export interface AlbumTrack {
  id: string;
  title: string;
  audioUrl: string;
  duration?: number;
}

export interface AlbumPayload {
  slug: string;
  title: string;
  artist: string;
  cover: string;
  editionNumber: number;
  editionTotal: number;
  tracks: AlbumTrack[];
  links: AlbumLinks;
  merchCards: AlbumActionCard[];
  ticketCards: AlbumActionCard[];
}

export const DEFAULT_MOCK_ALBUM_SLUG = 'tap-exclusive-demo';

const asString = (value: unknown) => String(value ?? '').trim();

const asOptionalString = (value: unknown) => {
  const normalized = asString(value);
  return normalized.length > 0 ? normalized : undefined;
};

const asFiniteNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getNestedValue = (value: any, path: string) => {
  return path.split('.').reduce((acc: any, segment) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return acc[segment];
  }, value);
};

const normalizeTrack = (value: any, index: number): AlbumTrack => {
  const rawDuration = [value?.duration, value?.durationSec, value?.seconds, value?.length]
    .map((entry) => Number(entry))
    .find((entry) => Number.isFinite(entry) && entry > 0);

  return {
    id: asString(value?.id || value?.trackId) || `track-${index + 1}`,
    title: asString(value?.title) || `Track ${index + 1}`,
    audioUrl: asString(value?.audioUrl || value?.trackUrl || value?.mp3Url),
    duration: Number.isFinite(Number(rawDuration)) ? Number(rawDuration) : undefined
  };
};

const normalizeActionCard = (value: any, index: number, prefix: 'merch' | 'ticket'): AlbumActionCard => {
  return {
    id: asString(value?.id || value?.cardId) || `${prefix}-${index + 1}`,
    title: asString(value?.title || value?.name || value?.label) || `${prefix === 'merch' ? 'Merch' : 'Ticket'} ${index + 1}`,
    subtitle: asOptionalString(value?.subtitle || value?.variant),
    description: asOptionalString(value?.description),
    price: asOptionalString(value?.price || value?.cost),
    date: asOptionalString(value?.date),
    location: asOptionalString(value?.location || value?.venue || value?.city),
    image: asOptionalString(value?.image || value?.imageUrl || value?.artwork),
    ctaLabel: asOptionalString(value?.ctaLabel || value?.buttonLabel || value?.cta),
    url: asOptionalString(value?.url || value?.href || value?.link)
  };
};

const normalizeActionCardList = (value: any, prefix: 'merch' | 'ticket'): AlbumActionCard[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => normalizeActionCard(entry, index, prefix))
    .filter((entry) => entry.title.length > 0);
};

const pickFirstArray = (value: any, paths: string[]): any[] => {
  for (const path of paths) {
    const candidate = getNestedValue(value, path);
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
};

const resolveEditionNumber = (value: any) =>
  asFiniteNumber(
    value?.editionNumber ??
      value?.edition_number ??
      getNestedValue(value, 'edition.number') ??
      getNestedValue(value, 'collectible.editionNumber'),
    1
  );

const resolveEditionTotal = (value: any) =>
  Math.max(
    asFiniteNumber(
      value?.editionTotal ??
        value?.edition_total ??
        getNestedValue(value, 'edition.total') ??
        getNestedValue(value, 'collectible.editionTotal'),
      1
    ),
    1
  );

const normalizeAlbumPayload = (slug: string, value: any): AlbumPayload => {
  const tracks = Array.isArray(value?.tracks)
    ? value.tracks
        .map((track: any, index: number) => normalizeTrack(track, index))
        .filter((track: AlbumTrack) => track.audioUrl.length > 0)
    : [];

  const links: AlbumLinks = {
    merch: asOptionalString(value?.links?.merch),
    tickets: asOptionalString(value?.links?.tickets),
    instagram: asOptionalString(value?.links?.instagram),
    tiktok: asOptionalString(value?.links?.tiktok),
    youtube: asOptionalString(value?.links?.youtube)
  };

  const merchCards = normalizeActionCardList(value?.merchCards, 'merch');
  const ticketCards = normalizeActionCardList(value?.ticketCards, 'ticket');

  return {
    slug: asString(value?.slug) || slug,
    title: asString(value?.title) || 'Untitled Album',
    artist: asString(value?.artist) || 'Unknown Artist',
    cover: asString(value?.cover),
    editionNumber: resolveEditionNumber(value),
    editionTotal: resolveEditionTotal(value),
    tracks,
    links,
    merchCards,
    ticketCards
  };
};

const buildAlbumPayloadFromApi = (slug: string, response: any): AlbumPayload | null => {
  const project = response?.project;
  if (!project) return null;

  const links: AlbumLinks = {
    merch: asOptionalString(project?.merchUrl || project?.links?.merch),
    tickets: asOptionalString(project?.ticketsUrl || project?.links?.tickets),
    instagram: asOptionalString(project?.instagramUrl || project?.links?.instagram),
    tiktok: asOptionalString(project?.tiktokUrl || project?.links?.tiktok),
    youtube: asOptionalString(project?.youtubeUrl || project?.links?.youtube)
  };

  const merchCardSources = pickFirstArray(project, [
    'merchCards',
    'links.merchCards',
    'links.merch.items',
    'merch.items',
    'merch'
  ]);
  const ticketCardSources = pickFirstArray(project, [
    'ticketCards',
    'links.ticketCards',
    'links.tickets.items',
    'tourDates',
    'events',
    'tickets'
  ]);

  const merchCards = normalizeActionCardList(merchCardSources, 'merch');
  const ticketCards = normalizeActionCardList(ticketCardSources, 'ticket');

  if (merchCards.length === 0 && links.merch) {
    merchCards.push({
      id: 'merch-primary',
      title: 'Official Merch',
      description: 'Limited drop items tied to this Tap-Album edition.',
      ctaLabel: 'Shop',
      url: links.merch
    });
  }

  if (ticketCards.length === 0 && links.tickets) {
    ticketCards.push({
      id: 'tickets-primary',
      title: 'Upcoming Show',
      description: 'Secure tickets directly from the artist store.',
      ctaLabel: 'Get Tickets',
      url: links.tickets
    });
  }

  const payload = normalizeAlbumPayload(slug, {
    slug: asString(project?.slug) || slug,
    title: asString(project?.title),
    artist: asString(project?.artistName || project?.artist),
    cover: asString(project?.coverUrl || project?.coverImageUrl || project?.cover || project?.coverSignedUrl),
    editionNumber: resolveEditionNumber(project),
    editionTotal: resolveEditionTotal(project),
    tracks: Array.isArray(response?.tracks) ? response.tracks : [],
    links,
    merchCards,
    ticketCards
  });

  return payload;
};

const fetchMockAlbumBySlug = async (slug: string): Promise<AlbumPayload> => {
  const response = await fetch(`/mock-albums/${encodeURIComponent(slug)}.json`, {
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`Unable to load mock album ${slug}.`);
  }

  const payload = await response.json();
  return normalizeAlbumPayload(slug, payload);
};

export const fetchAlbumBySlug = async (slug: string): Promise<AlbumPayload> => {
  const normalizedSlug = asString(slug);
  if (!normalizedSlug) {
    throw new Error('Album slug is required.');
  }

  try {
    const response = await Api.getProjectBySlug(normalizedSlug);
    const mapped = buildAlbumPayloadFromApi(normalizedSlug, response);
    if (mapped) {
      return mapped;
    }
  } catch (error) {
    if (!import.meta.env.DEV) {
      throw error;
    }
  }

  if (!import.meta.env.DEV) {
    throw new Error(`Unable to load album ${normalizedSlug}.`);
  }

  try {
    return await fetchMockAlbumBySlug(normalizedSlug);
  } catch {
    if (normalizedSlug === DEFAULT_MOCK_ALBUM_SLUG) {
      throw new Error(`Unable to load album ${normalizedSlug}.`);
    }
    return fetchMockAlbumBySlug(DEFAULT_MOCK_ALBUM_SLUG);
  }
};
