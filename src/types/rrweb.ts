// rrweb type definitions
import * as rrweb from "rrweb";

// Define EventType enum locally based on rrweb's structure
export enum EventType {
  DomContentLoaded = 0,
  Load = 1,
  FullSnapshot = 2,
  IncrementalSnapshot = 3,
  Meta = 4,
  Custom = 5,
  Plugin = 6,
}

// A generic rrweb event, since eventWithTime is not exported
export interface RRWebEvent {
  type: EventType;
  data: any;
  timestamp: number;
  tabId?: string;
}

// Use rrweb's built-in event types
export type FullSnapshotEvent = RRWebEvent & { type: EventType.FullSnapshot };
export type IncrementalSnapshotEvent = RRWebEvent & {
  type: EventType.IncrementalSnapshot;
};
export type MetaEvent = RRWebEvent & { type: EventType.Meta };
export type CustomEvent = RRWebEvent & { type: EventType.Custom };
export type PluginEvent = RRWebEvent & { type: EventType.Plugin };

export interface RecordingStats {
  totalEvents: number;
  duration: number;
  startTime: number;
  endTime: number;
  eventTypeCounts: Record<number, number>;
  eventTypes: Record<number, string>;
}

export interface ReplayerConfig {
  root: HTMLElement;
  skipInactive?: boolean;
  showWarning?: boolean;
  showDebug?: boolean;
  blockClass?: string;
  maskTextClass?: string;
  speed?: number;
  mouseTail?: boolean;
  triggerFocus?: boolean;
  UNSAFE_replayCanvas?: boolean;
  useVirtualDom?: boolean;
  plugins?: any[];
}

export interface SnapshotOptions {
  blockClass?: string;
  maskTextClass?: string;
  ignoreClass?: string;
  inlineStylesheet?: boolean;
  maskAllInputs?: boolean;
  preserveWhiteSpace?: boolean;
  mirror?: any;
} 