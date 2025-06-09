// RecordingCutter.js - Utility for cutting rrweb recordings into smaller clips

import { Replayer } from "rrweb";
import { snapshot } from "rrweb-snapshot";

/**
 * Converts absolute timestamp to relative seconds
 * @param {Array} events - rrweb events array
 * @param {number} timestamp - Absolute timestamp
 * @returns {number} Relative seconds from start
 */
export function timestampToRelativeTime(events, timestamp) {
  if (!events || events.length === 0) return 0;
  const startTime = events[0].timestamp;
  return (timestamp - startTime) / 1000;
}

/**
 * Formats seconds as MM:SS or HH:MM:SS
 * @param {number} seconds - Total seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Parses time string (MM:SS, HH:MM:SS, or just seconds) to total seconds
 * @param {string} timeStr - Time string like "1:30", "0:05", "90", etc.
 * @returns {number} Total seconds
 */
export function parseTimeString(timeStr) {
  if (!timeStr) return 0;

  // If it's just a number, treat as seconds
  if (/^\d+$/.test(timeStr)) {
    return parseInt(timeStr);
  }

  // Parse MM:SS or HH:MM:SS format
  const parts = timeStr.split(":").map(Number);
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return 0;
}

/**
 * Cuts an rrweb recording to show only events within a specific time range
 * @param {Array} events - Original rrweb events array
 * @param {number} centerTimeSeconds - Relative time in seconds from start of recording
 * @param {number} beforeSeconds - Seconds to include before the center time (default: 5)
 * @param {number} afterSeconds - Seconds to include after the center time (default: 5)
 * @returns {Array} New rrweb events array for the clipped recording
 */
export function cutRecording(
  events,
  centerTimeSeconds,
  beforeSeconds = 5,
  afterSeconds = 5
) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    throw new Error("Invalid events array provided");
  }

  // Convert relative time to absolute timestamp
  const startTime = events[0].timestamp;
  const centerTimestamp = startTime + centerTimeSeconds * 1000;

  const beforeMs = beforeSeconds * 1000;
  const afterMs = afterSeconds * 1000;
  const cutStartTime = centerTimestamp - beforeMs;
  const cutEndTime = centerTimestamp + afterMs;

  console.log(
    `Cutting recording around ${formatTime(
      centerTimeSeconds
    )} (${centerTimeSeconds}s)`
  );
  console.log(
    `Time range: ${formatTime(
      centerTimeSeconds - beforeSeconds
    )} to ${formatTime(centerTimeSeconds + afterSeconds)}`
  );

  // Find the full snapshot that's closest to our cut time (before or after)
  let fullSnapshot = null;
  let bestDistance = Infinity;

  for (const event of events) {
    if (event.type === 2) {
      const distance = Math.abs(event.timestamp - cutStartTime);
      if (distance < bestDistance) {
        fullSnapshot = event;
        bestDistance = distance;
      }
    }
  }

  if (!fullSnapshot) {
    throw new Error("No full snapshot found in recording");
  }

  console.log(
    `Using full snapshot at ${fullSnapshot.timestamp}, distance from cut: ${bestDistance}ms`
  );

  // Take a conservative approach: include ALL events
  // from the closest full snapshot through our entire clip range
  const snapshotTime = fullSnapshot.timestamp;
  const rangeStart = Math.min(snapshotTime, cutStartTime);
  const rangeEnd = cutEndTime;

  // Get all events in the complete range we need
  const neededEvents = events.filter((event) => {
    return event.timestamp >= rangeStart && event.timestamp <= rangeEnd;
  });

  // Create the new events array, ALWAYS starting with the full snapshot
  const newEvents = [];

  // Always add the full snapshot first
  newEvents.push({
    ...fullSnapshot,
    timestamp: fullSnapshot.timestamp,
  });

  // Add all other needed events (excluding the original full snapshot to avoid duplication)
  for (const event of neededEvents) {
    if (event.timestamp !== fullSnapshot.timestamp || event.type !== 2) {
      newEvents.push({
        ...event,
        timestamp: event.timestamp,
      });
    }
  }

  // Ensure we have at least 2 events total
  if (newEvents.length < 2) {
    const lastTimestamp = newEvents[newEvents.length - 1].timestamp;
    newEvents.push({
      type: 4, // Meta event
      data: { href: window.location.href },
      timestamp: lastTimestamp + 100,
    });
  }

  // Sort by timestamp to ensure proper order
  newEvents.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`Original recording: ${events.length} events`);
  console.log(`Clipped recording: ${newEvents.length} events`);
  console.log(`Time span: ${beforeSeconds + afterSeconds} seconds`);

  return newEvents;
}

/**
 * Finds events containing specific text or attributes
 * @param {Array} events - rrweb events array
 * @param {string} searchTerm - Text to search for
 * @returns {Array} Array of events containing the search term
 */
export function findEventsByContent(events, searchTerm) {
  const matchingEvents = [];

  for (const event of events) {
    const eventStr = JSON.stringify(event).toLowerCase();
    if (eventStr.includes(searchTerm.toLowerCase())) {
      matchingEvents.push(event);
    }
  }

  return matchingEvents;
}

/**
 * Analyzes a recording and provides statistics
 * @param {Array} events - rrweb events array
 * @returns {Object} Recording statistics
 */
export function analyzeRecording(events) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return null;
  }

  const firstTimestamp = events[0].timestamp;
  const lastTimestamp = events[events.length - 1].timestamp;
  const duration = (lastTimestamp - firstTimestamp) / 1000; // in seconds

  const eventTypeCounts = {};
  for (const event of events) {
    eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;
  }

  return {
    totalEvents: events.length,
    duration: duration,
    startTime: firstTimestamp,
    endTime: lastTimestamp,
    eventTypeCounts: eventTypeCounts,
    eventTypes: {
      1: "DomContentLoaded",
      2: "FullSnapshot",
      3: "IncrementalSnapshot",
      4: "Meta",
      5: "Custom",
      6: "Plugin",
    },
  };
}

/**
 * Helper function to ensure pause completes
 * @param {Object} replayer - The rrweb replayer instance
 * @param {number} relativeTime - Target relative time from start
 * @returns {Promise<void>}
 */
const pauseAndWait = (replayer, relativeTime) => {
  return new Promise((resolve, reject) => {
    try {
      // Pause the replayer
      replayer.pause();

      // Wait for DOM to be fully reconstructed
      setTimeout(() => {
        const currentTime = replayer.getCurrentTime();
        console.log(
          `Paused at: ${currentTime}ms, Target relative time: ${relativeTime}ms`
        );
        resolve();
      }, 300); // Give DOM more time to stabilize
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Creates a true synthetic snapshot by replaying to a specific point and capturing DOM state
 * @param {Array} events - Original rrweb events array
 * @param {number} targetTimestamp - The timestamp to capture DOM state at
 * @returns {Promise<Object>} Synthetic full snapshot at the target timestamp
 */
async function createTrueSyntheticSnapshot(events, targetTimestamp) {
  return new Promise(async (resolve, reject) => {
    let container = null;
    let replayer = null;

    try {
      // Create a hidden container for replay
      container = document.createElement("div");
      container.style.position = "fixed";
      container.style.top = "-9999px";
      container.style.left = "-9999px";
      container.style.width = "1920px";
      container.style.height = "1080px";
      container.style.overflow = "hidden";
      container.style.visibility = "hidden";
      document.body.appendChild(container);

      // Get the start time from events
      const startTime = events[0].timestamp;
      const relativeTarget = targetTimestamp - startTime;

      console.log(
        `Creating replayer for synthetic snapshot at ${targetTimestamp}ms (relative: ${relativeTarget}ms)`
      );

      // Create replayer with synchronous rendering
      replayer = new Replayer(events, {
        root: container,
        skipInactive: false,
        showWarning: false,
        showDebug: false,
        blockClass: "rr-block",
        maskTextClass: "rr-mask",
        speed: 1,
        mouseTail: false,
        triggerFocus: false,
        UNSAFE_replayCanvas: false,
        useVirtualDom: false,
        plugins: [],
      });

      // Wait for replayer to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get replayer metadata to check if it's ready
      const replayerMeta = replayer.getMetaData();
      console.log("Replayer metadata:", replayerMeta);

      // Play to target time
      replayer.play(relativeTarget);

      // Wait for playback to reach target
      await new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 1000; // 10 seconds max

        const checkInterval = setInterval(() => {
          attempts++;
          const currentTime = replayer.getCurrentTime();

          if (currentTime >= relativeTarget - 10) {
            clearInterval(checkInterval);
            console.log(`Reached target time after ${attempts * 10}ms`);
            resolve();
          } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            reject(
              new Error(
                `Timeout waiting for playback to reach target. Current: ${currentTime}, Target: ${relativeTarget}`
              )
            );
          }
        }, 10);
      });

      // Pause and wait for DOM to stabilize
      await pauseAndWait(replayer, relativeTarget);

      // Get the iframe
      const iframe = container.querySelector("iframe");
      if (!iframe) {
        console.error("No iframe found in container");
        console.error("Container innerHTML:", container.innerHTML);
        throw new Error("Could not find replay iframe");
      }

      if (!iframe.contentDocument) {
        console.error("iframe.contentDocument is null");
        console.error("iframe src:", iframe.src);
        throw new Error("Could not access iframe content document");
      }

      console.log("Taking snapshot of iframe content...");

      // Take the snapshot
      const domSnapshot = snapshot(iframe.contentDocument, {
        blockClass: "rr-block",
        maskTextClass: "rr-mask",
        ignoreClass: "rr-ignore",
        inlineStylesheet: true,
        maskAllInputs: false,
        preserveWhiteSpace: true,
        mirror: replayer.getMirror(),
      });

      if (!domSnapshot) {
        throw new Error("Snapshot returned null");
      }

      // Get metadata
      const meta = replayer.getMetaData() || {};
      const tabId = events.find((e) => e.tabId)?.tabId;

      // Create the synthetic full snapshot event
      const syntheticSnapshot = {
        type: 2, // FullSnapshot
        data: {
          node: domSnapshot,
          initialOffset: {
            left: 0,
            top: 0,
          },
        },
        timestamp: targetTimestamp,
      };

      // Add tabId if present
      if (tabId !== undefined) {
        syntheticSnapshot.tabId = tabId;
      }

      // Clean up
      replayer.destroy();
      document.body.removeChild(container);

      console.log("Synthetic snapshot created successfully");
      resolve(syntheticSnapshot);
    } catch (error) {
      console.error("Error creating synthetic snapshot:", error);

      // Clean up on error
      if (replayer) {
        try {
          replayer.destroy();
        } catch (e) {
          console.error("Error destroying replayer:", e);
        }
      }
      if (container && container.parentNode) {
        document.body.removeChild(container);
      }

      reject(error);
    }
  });
}

/**
 * Trims a recording to keep only events within a specific time range
 * @param {Array} events - Original rrweb events array
 * @param {number} startMs - Start time in milliseconds (absolute timestamp)
 * @param {number} endMs - End time in milliseconds (absolute timestamp)
 * @returns {Array} New rrweb events array for the trimmed recording
 */
export async function trimRecording(events, startMs, endMs) {
  if (!events || !Array.isArray(events) || events.length === 0) {
    throw new Error("Invalid events array provided");
  }

  console.log(`Trimming recording from ${startMs}ms to ${endMs}ms`);
  console.log(`Duration to trim: ${(endMs - startMs) / 1000} seconds`);

  // Validate time range
  const recordingStart = events[0].timestamp;
  const recordingEnd = events[events.length - 1].timestamp;

  console.log(`Recording spans from ${recordingStart} to ${recordingEnd}`);
  console.log(
    `Recording total duration: ${
      (recordingEnd - recordingStart) / 1000
    } seconds`
  );

  if (startMs < recordingStart) {
    console.warn(
      `Start time ${startMs}ms is before recording start ${recordingStart}ms, adjusting`
    );
    startMs = recordingStart;
  }

  if (endMs > recordingEnd) {
    console.warn(
      `End time ${endMs}ms is after recording end ${recordingEnd}ms, adjusting`
    );
    endMs = recordingEnd;
  }

  if (startMs >= endMs) {
    console.error(`Invalid time range: startMs=${startMs}, endMs=${endMs}`);
    throw new Error(
      `Invalid time range: start time (${startMs}ms) must be before end time (${endMs}ms)`
    );
  }

  try {
    // Create a true synthetic snapshot at the exact trim start point
    console.log(
      `Creating synthetic snapshot at trim start point (${startMs}ms)...`
    );

    // First, try the simple approach - check if we have a snapshot close enough
    const snapshots = events.filter((e) => e.type === 2);
    const closeSnapshot = snapshots.find(
      (s) => Math.abs(s.timestamp - startMs) < 1000 // Within 1 second
    );

    let syntheticSnapshot;
    if (closeSnapshot && closeSnapshot.timestamp === startMs) {
      // Perfect match - use it directly
      console.log(`Found exact snapshot at trim point`);
      syntheticSnapshot = closeSnapshot;
    } else {
      // Need to create synthetic snapshot
      syntheticSnapshot = await createTrueSyntheticSnapshot(events, startMs);
      console.log(`Synthetic snapshot created successfully`);
    }

    // Build the new events array starting at 0
    const newEvents = [];

    // Get original meta event for viewport info
    const originalMeta = events.find((e) => e.type === 4);

    // Create meta event at timestamp 0
    const metaEvent = {
      type: 4, // Meta
      data: {
        href: originalMeta?.data?.href || window.location.href,
        width: originalMeta?.data?.width || 1920,
        height: originalMeta?.data?.height || 1080,
      },
      timestamp: 0,
    };

    // Add tabId if present
    if (syntheticSnapshot.tabId !== undefined) {
      metaEvent.tabId = syntheticSnapshot.tabId;
    }

    newEvents.push(metaEvent);

    // Add synthetic snapshot at timestamp 1
    const adjustedSnapshot = {
      ...syntheticSnapshot,
      timestamp: 1,
    };
    newEvents.push(adjustedSnapshot);

    // Include only events within the trim range, adjusting timestamps
    const eventsInRange = events.filter((event) => {
      return event.timestamp > startMs && event.timestamp <= endMs;
    });

    console.log(`Found ${eventsInRange.length} events within trim range`);

    // Add all events in range with adjusted timestamps
    for (const event of eventsInRange) {
      const adjustedEvent = {
        ...event,
        timestamp: event.timestamp - startMs + 2, // Start after meta and snapshot
      };
      newEvents.push(adjustedEvent);
    }

    // Sort by timestamp (should already be in order)
    newEvents.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Original recording: ${events.length} events`);
    console.log(`Trimmed recording: ${newEvents.length} events`);
    console.log(`Trimmed duration: ${(endMs - startMs) / 1000} seconds`);

    return newEvents;
  } catch (error) {
    console.error("Failed to create synthetic snapshot:", error);

    // Fallback to the old method if synthetic snapshot fails
    console.log("Falling back to traditional trim method...");
    return trimRecordingFallback(events, startMs, endMs);
  }
}

// Keep the old implementation as a fallback
function trimRecordingFallback(events, startMs, endMs) {
  // Find ALL full snapshots and choose the best one
  const fullSnapshots = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].type === 2) {
      fullSnapshots.push({ snapshot: events[i], index: i });
    }
  }

  if (fullSnapshots.length === 0) {
    throw new Error("No full snapshot found in recording");
  }

  // Find the best snapshot - prefer one close to but before the start time
  let baseSnapshot = null;
  let baseSnapshotIndex = -1;

  // First, look for snapshots within 30 seconds before the trim start
  const threshold = 30000; // 30 seconds in milliseconds
  for (const { snapshot, index } of fullSnapshots) {
    if (
      snapshot.timestamp <= startMs &&
      snapshot.timestamp >= startMs - threshold
    ) {
      baseSnapshot = snapshot;
      baseSnapshotIndex = index;
    }
  }

  // If no snapshot within threshold, find the closest one before start
  if (!baseSnapshot) {
    for (const { snapshot, index } of fullSnapshots) {
      if (snapshot.timestamp <= startMs) {
        baseSnapshot = snapshot;
        baseSnapshotIndex = index;
      }
    }
  }

  // If still no snapshot (trim starts before first snapshot), use the first one
  if (!baseSnapshot) {
    baseSnapshot = fullSnapshots[0].snapshot;
    baseSnapshotIndex = fullSnapshots[0].index;
  }

  if (!baseSnapshot) {
    throw new Error("No full snapshot found in recording");
  }

  console.log(
    `Using base snapshot at index ${baseSnapshotIndex}, timestamp ${baseSnapshot.timestamp}ms`
  );
  console.log(
    `Time from base snapshot to trim start: ${
      (startMs - baseSnapshot.timestamp) / 1000
    } seconds`
  );

  // Build the new events array
  const newEvents = [];

  // Add the base snapshot
  newEvents.push({
    ...baseSnapshot,
    timestamp: baseSnapshot.timestamp,
  });

  // Add meta event if we have one
  const metaEvent = events.find((e) => e.type === 4);
  if (metaEvent) {
    newEvents.push({
      ...metaEvent,
      timestamp: baseSnapshot.timestamp + 1,
    });
  }

  // Count events in different ranges for debugging
  let eventsBeforeTrim = 0;
  let eventsInTrim = 0;

  // Include necessary events to reconstruct DOM state at startMs
  // and all events within the trim range
  for (let i = baseSnapshotIndex + 1; i < events.length; i++) {
    const event = events[i];

    // Stop if we've passed the end time
    if (event.timestamp > endMs) {
      break;
    }

    // Skip full snapshots - we already have our base
    if (event.type === 2) {
      continue;
    }

    // For events before the trim start, only include mutations
    // that are necessary for DOM reconstruction
    if (event.timestamp < startMs) {
      // Only include incremental snapshots (mutations)
      if (event.type === 3 && event.data && event.data.source === 0) {
        newEvents.push(event);
        eventsBeforeTrim++;
      }
    } else {
      // Include all events within the trim range
      newEvents.push(event);
      eventsInTrim++;
    }
  }

  console.log(`Events included before trim start: ${eventsBeforeTrim}`);
  console.log(`Events included within trim range: ${eventsInTrim}`);

  // Sort by timestamp to ensure proper order
  newEvents.sort((a, b) => a.timestamp - b.timestamp);

  // If we need at least 2 events and only have 1, add a minimal event
  if (newEvents.length === 1) {
    console.log("Only one event found, adding minimal event");
    newEvents.push({
      type: 3, // IncrementalSnapshot
      data: {
        source: 0, // Mutation
        texts: [],
        attributes: [],
        removes: [],
        adds: [],
      },
      timestamp: baseSnapshot.timestamp + 10,
    });
  }

  // Shift timestamps so playback starts at the trim point
  const timeShift = startMs - baseSnapshot.timestamp;
  const baseTime = newEvents[0].timestamp;

  console.log(`Time shift: ${timeShift / 1000} seconds`);
  console.log(`Adjusting timestamps to start playback at trim point...`);

  // Adjust all timestamps
  const shiftedEvents = newEvents.map((event, index) => {
    // Calculate relative time from base
    const relativeTime = event.timestamp - baseTime;

    // For events before the trim start, compress them into the first 100ms
    if (
      event.timestamp < startMs &&
      event.type === 3 &&
      event.data.source === 0
    ) {
      // Compress pre-trim mutations into first 100ms
      const compressionRatio = Math.min(relativeTime / timeShift, 1);
      return {
        ...event,
        timestamp: compressionRatio * 100,
      };
    } else {
      // For events at or after trim start, maintain relative timing
      const newTimestamp = event.timestamp - startMs + 100;
      return {
        ...event,
        timestamp: newTimestamp,
      };
    }
  });

  console.log(`Original recording: ${events.length} events`);
  console.log(`Trimmed recording: ${shiftedEvents.length} events`);

  // Validate we have at least 2 events
  if (shiftedEvents.length < 2) {
    throw new Error(
      `Trimmed recording has only ${shiftedEvents.length} events, need at least 2`
    );
  }

  return shiftedEvents;
}
