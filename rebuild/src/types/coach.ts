import type { firestore } from 'firebase-admin';

export type CoachStatus = 'active' | 'suspended' | 'deleting' | 'provisioning';

export interface CoachLineConfig {
  channelAccessTokenRef: string;
  channelSecretRef: string;
  liffCoachId: string;
  liffStudentId: string;
}

export interface CoachBranding {
  displayName: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

export interface CoachLocation {
  name: string;
  url: string;
}

export interface CoachService {
  name: string;
  hours: number;
}

export interface CoachBusinessHours {
  start: number;
  end: number;
}

export interface CoachSettings {
  timezone: string;
  businessHours: CoachBusinessHours;
  locations: CoachLocation[];
  services: CoachService[];
}

export type CoachFlags = Record<string, boolean>;

export interface Coach {
  name: string;
  slug: string;
  status: CoachStatus;
  deletedAt: firestore.Timestamp | null;
  ownerLineUserIds: string[];
  line: CoachLineConfig;
  branding: CoachBranding;
  settings: CoachSettings;
  flags: CoachFlags;
  createdAt: firestore.Timestamp;
  updatedAt: firestore.Timestamp;
}

export type CoachWithId = Coach & { id: string };
