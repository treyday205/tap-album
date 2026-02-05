
import { Project, Track, ProjectLink, User, Event, UserRole, EventType } from '../types';

const STORAGE_KEYS = {
  PROJECTS: 'tap_projects',
  TRACKS: 'tap_tracks',
  LINKS: 'tap_links',
  USERS: 'tap_users',
  EVENTS: 'tap_events',
  CURRENT_USER: 'tap_current_user'
};

// Initial Mock Data
const MOCK_USER: User = {
  userId: 'u1',
  email: 'artist@example.com',
  displayName: 'Wave Rider',
  role: UserRole.ARTIST,
  createdAt: new Date().toISOString()
};

/**
 * Deep cleans an object to ensure it only contains JSON-serializable primitives.
 * Prevents circular references (like DOM nodes or React internals) from breaking storage.
 * Uses a WeakSet to prevent infinite recursion on circular structures.
 */
const deepClean = (obj: any, seen = new WeakSet()): any => {
  // Primitives and null
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Detect circularity
  if (seen.has(obj)) {
    return undefined;
  }

  // Block DOM nodes and Audio elements
  if (
    obj instanceof HTMLElement || 
    obj.nodeType || 
    (obj.constructor && (obj.constructor.name === 'HTMLAudioElement' || obj.constructor.name.includes('Element')))
  ) {
    return undefined;
  }

  seen.add(obj);

  // Handle Arrays
  if (Array.isArray(obj)) {
    return obj
      .map(item => deepClean(item, seen))
      .filter(v => v !== undefined);
  }

  // Handle Objects
  const cleaned: any = {};
  const keys = Object.keys(obj);
  
  for (const key of keys) {
    // Skip React internals and private properties
    if (key.startsWith('__react') || key.startsWith('_react') || key.startsWith('$$')) {
      continue;
    }
    
    const val = deepClean(obj[key], seen);
    if (val !== undefined) {
      cleaned[key] = val;
    }
  }
  
  return cleaned;
};

const get = <T,>(key: string, defaultValue: T): T => {
  const data = localStorage.getItem(key);
  try {
    return data ? JSON.parse(data) : defaultValue;
  } catch (e) {
    console.error("Failed to parse storage key:", key, e);
    return defaultValue;
  }
};

const set = <T,>(key: string, value: T): boolean => {
  try {
    // Guard against root-level DOM nodes
    if (value instanceof HTMLElement || (value && (value as any).nodeType)) {
      console.error("Storage Error: Attempted to save a DOM node directly.");
      return false;
    }

    const cleaned = deepClean(value);
    const sanitizedValue = JSON.stringify(cleaned);
    localStorage.setItem(key, sanitizedValue);
    return true;
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      alert("Storage limit reached! Base64 files might be too large. Please use external URLs if possible.");
    }
    console.error("Storage failed:", e);
    return false;
  }
};

export const StorageService = {
  init: () => {
    if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
      set(STORAGE_KEYS.USERS, [MOCK_USER]);
      set(STORAGE_KEYS.CURRENT_USER, MOCK_USER);
    }
  },

  getCurrentUser: (): User | null => get(STORAGE_KEYS.CURRENT_USER, null),

  getProjects: (): Project[] => get(STORAGE_KEYS.PROJECTS, []),
  getProjectBySlug: (slug: string): Project | undefined => 
    get<Project[]>(STORAGE_KEYS.PROJECTS, []).find(p => p.slug === slug),
  getProjectById: (id: string): Project | undefined => 
    get<Project[]>(STORAGE_KEYS.PROJECTS, []).find(p => p.projectId === id),
  
  saveProject: (project: Project) => {
    const projects = StorageService.getProjects();
    const index = projects.findIndex(p => p.projectId === project.projectId);
    if (index > -1) {
      projects[index] = { ...project, updatedAt: new Date().toISOString() };
    } else {
      projects.push(project);
    }
    set(STORAGE_KEYS.PROJECTS, projects);
  },

  deleteProject: (id: string) => {
    const projects = StorageService.getProjects().filter(p => p.projectId !== id);
    set(STORAGE_KEYS.PROJECTS, projects);
    const allTracks = get<Track[]>(STORAGE_KEYS.TRACKS, []);
    set(STORAGE_KEYS.TRACKS, allTracks.filter(t => t.projectId !== id));
    const allLinks = get<ProjectLink[]>(STORAGE_KEYS.LINKS, []);
    set(STORAGE_KEYS.LINKS, allLinks.filter(l => l.projectId !== id));
  },

  getTracks: (projectId: string): Track[] => 
    get<Track[]>(STORAGE_KEYS.TRACKS, [])
      .filter(t => t.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder),

  saveTrack: (track: Track) => {
    const tracks = get<Track[]>(STORAGE_KEYS.TRACKS, []);
    const index = tracks.findIndex(t => t.trackId === track.trackId);
    if (index > -1) {
      tracks[index] = track;
    } else {
      tracks.push(track);
    }
    set(STORAGE_KEYS.TRACKS, tracks);
  },

  deleteTrack: (trackId: string) => {
    const tracks = get<Track[]>(STORAGE_KEYS.TRACKS, []).filter(t => t.trackId !== trackId);
    set(STORAGE_KEYS.TRACKS, tracks);
  },

  getLinks: (projectId: string): ProjectLink[] => 
    get<ProjectLink[]>(STORAGE_KEYS.LINKS, [])
      .filter(l => l.projectId === projectId)
      .sort((a, b) => a.sortOrder - b.sortOrder),

  saveLink: (link: ProjectLink) => {
    const links = get<ProjectLink[]>(STORAGE_KEYS.LINKS, []);
    const index = links.findIndex(l => l.linkId === link.linkId);
    if (index > -1) {
      links[index] = link;
    } else {
      links.push(link);
    }
    set(STORAGE_KEYS.LINKS, links);
  },

  deleteLink: (linkId: string) => {
    const links = get<ProjectLink[]>(STORAGE_KEYS.LINKS, []).filter(l => l.linkId !== linkId);
    set(STORAGE_KEYS.LINKS, links);
  },

  logEvent: (projectId: string, eventType: EventType, label: string) => {
    const events = get<Event[]>(STORAGE_KEYS.EVENTS, []);
    const newEvent: Event = {
      eventId: Math.random().toString(36).substr(2, 9),
      projectId,
      eventType,
      label: String(label), // Ensure label is a string
      createdAt: new Date().toISOString()
    };
    events.push(newEvent);
    set(STORAGE_KEYS.EVENTS, events);
  }
};
