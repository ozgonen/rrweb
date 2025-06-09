# rrweb Recording Trimming Logic

## Overview

The trimming functionality in the rrweb player allows users to extract a specific time range from a larger recording. This is particularly useful for:
- Creating clips of specific user interactions
- Reducing file sizes by removing unnecessary portions
- Focusing on problematic areas for debugging
- Sharing concise recordings of specific issues

## The Challenge

rrweb recordings consist of a series of events that capture DOM changes over time. The main challenge in trimming is that rrweb uses an event-based system where:

1. **Full Snapshots** (type 2): Complete DOM state at a specific moment
2. **Incremental Snapshots** (type 3): Changes (mutations) to the DOM since the last snapshot
3. **Meta Events** (type 4): Metadata like page URL, viewport size
4. **Other Events**: Mouse movements, interactions, etc.

Simply cutting events at arbitrary timestamps would break the recording because incremental changes depend on having a valid base state (full snapshot) to apply mutations to.

## Core Concepts

### 1. Event Dependencies

```
Time:     0ms    500ms   1000ms  1500ms  2000ms  2500ms
Events:   [FS]---[IC]----[IC]----[IC]----[FS]----[IC]
          Full   Incr.   Incr.   Incr.   Full    Incr.
          Snap   Change  Change  Change  Snap    Change
```

If we want to trim from 800ms to 1800ms, we can't just take events in that range because:
- The incremental changes at 1000ms and 1500ms depend on the full snapshot at 0ms
- Without the base state, the changes can't be applied

### 2. Synthetic Full Snapshot

The solution is to create a **synthetic full snapshot** at the trim start point that represents the complete DOM state at that moment. This involves:

1. Finding the last full snapshot before the trim start
2. Theoretically applying all incremental changes between that snapshot and the trim start
3. Creating a new full snapshot with the resulting DOM state

## Implementation Details

### The `trimRecording` Function

```javascript
export function trimRecording(events, startMs, endMs)
```

This function handles the entire trimming process:

#### 1. **Validation Phase**
```javascript
// Validate input
if (!events || !Array.isArray(events) || events.length === 0) {
  throw new Error("Invalid events array provided");
}

// Validate time range
const recordingStart = events[0].timestamp;
const recordingEnd = events[events.length - 1].timestamp;

if (startMs < recordingStart) {
  startMs = recordingStart; // Adjust to recording bounds
}

if (endMs > recordingEnd) {
  endMs = recordingEnd; // Adjust to recording bounds
}

if (startMs >= endMs) {
  throw new Error("Invalid time range");
}
```

#### 2. **Synthetic Snapshot Creation**
```javascript
const syntheticSnapshot = createSyntheticSnapshot(events, startMs);
```

This creates a full snapshot representing the DOM state at the exact trim start time.

#### 3. **Event Selection**
```javascript
// Get events within range (excluding start to avoid duplicates)
const eventsInRange = events.filter((event) => {
  return event.timestamp > startMs && event.timestamp <= endMs;
});
```

Note: We use `>` for start time to avoid including events at the exact start timestamp, as we already have the synthetic snapshot.

#### 4. **Building the Trimmed Recording**
```javascript
const newEvents = [];

// Always start with synthetic full snapshot
newEvents.push(syntheticSnapshot);

// Add meta event if needed
const metaEvent = events.find(e => e.type === 4);
if (metaEvent && !eventsInRange.some(e => e.type === 4)) {
  newEvents.push({
    ...metaEvent,
    timestamp: startMs + 1,
  });
}

// Add all non-snapshot events in range
for (const event of eventsInRange) {
  if (event.type === 2) continue; // Skip full snapshots
  newEvents.push(event);
}
```

#### 5. **Ensuring Minimum Events**
rrweb's Replayer requires at least 2 events to function:

```javascript
if (newEvents.length === 1) {
  // Add minimal incremental snapshot
  newEvents.push({
    type: 3,
    data: {
      source: 0, // Mutation
      texts: [], attributes: [], removes: [], adds: []
    },
    timestamp: startMs + 10,
  });
}
```

### The `createSyntheticSnapshot` Function

```javascript
function createSyntheticSnapshot(events, targetTimestamp)
```

This function creates a full snapshot at any point in time:

1. **Find Base Snapshot**
   - Locates the most recent full snapshot before the target time
   - Falls back to the first snapshot if none exist before target

2. **Clone and Adjust**
   - Deep clones the base snapshot to avoid mutations
   - Updates the timestamp to the target time

3. **Validate Structure**
   - Ensures required properties exist (`data`, `node`, `href`)
   - Adds missing properties with sensible defaults

### Current Behavior

The current implementation uses an optimized approach that balances file size with playback correctness:

```javascript
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
```

**How It Works:**
1. **Synthetic Snapshot Creation**: Uses rrweb's `Replayer` and `snapshot` to create a true DOM snapshot at the exact trim point
2. **Headless Replay**: Replays the recording in a hidden container up to the trim start time
3. **DOM Capture**: Takes a snapshot of the DOM state at the exact moment
4. **Clean Trim**: Only includes events from the trim start onwards, no pre-trim events needed

**What This Means:**
- When you trim from 1:05 to 1:16:
  - The system replays the recording up to 1:05 in the background
  - A perfect snapshot is taken of the DOM at exactly 1:05
  - The trimmed recording contains only events from 1:05 to 1:16
- No pre-trim events are included at all
- The playback starts exactly at 1:05 with the correct DOM state
- No buildup or flash - the recording begins precisely where you trimmed it

**Optimization for Long Recordings:**
This approach is especially important for recordings that span hours:
- A 2-hour recording might have millions of events
- Our method only includes the necessary mutations, not all events
- This can reduce file size from hundreds of MB to just a few MB

**Requirements & Limitations:**
- Requires running in a browser environment (cannot run in Node.js)
- The synthetic snapshot creation takes a few seconds for long recordings
- May fail if the recording contains certain types of dynamic content (e.g., WebGL, complex canvas operations)
- Falls back to the traditional method if synthetic snapshot creation fails
- Memory intensive for very large recordings

## Usage Example

```javascript
// Load a recording
const events = JSON.parse(recordingData);

// Trim from 5 seconds to 15 seconds (absolute timestamps)
const recordingStart = events[0].timestamp;
const startMs = recordingStart + 5000;  // 5 seconds from start
const endMs = recordingStart + 15000;   // 15 seconds from start

try {
  // Note: trimRecording is now async
  const trimmedEvents = await trimRecording(events, startMs, endMs);
  
  // Save or play the trimmed recording
  const trimmedRecording = JSON.stringify(trimmedEvents);
  
} catch (error) {
  console.error('Trimming failed:', error.message);
}
```

## Troubleshooting

If synthetic snapshot creation fails:
1. Check browser console for detailed error messages
2. Ensure you're running in a browser environment (not Node.js)
3. Try using a recording with simpler content
4. The system will automatically fall back to the traditional method

Common issues:
- **"Could not find replay iframe"**: The replayer failed to initialize properly
- **"Could not access iframe content document"**: Cross-origin or security restrictions
- **"Timeout creating synthetic snapshot"**: Recording is too complex or large

## Error Handling

The trimming logic handles several error cases:

1. **Invalid Input**
   - Empty or non-array events
   - Invalid time ranges (start >= end)

2. **Missing Snapshots**
   - No full snapshots in recording
   - Corrupted snapshot data

3. **Insufficient Events**
   - Ensures at least 2 events in output
   - Adds synthetic events if needed

## Visual Timeline Example

Original Recording:
```
0s          5s          10s         15s         20s
|-----------|-----------|-----------|-----------|
[FS]  [IC] [IC] [IC]  [FS]  [IC] [IC]  [IC]  [FS]
      User clicks      Page loads   Mouse moves
```

Trimming from 3s to 12s - With Synthetic Snapshot:
```
3s                     12s
|---------------------|
[Synthetic FS] [IC] [IC] [FS] [IC] [IC]
```

What Happens Behind the Scenes:
1. **Background Replay**: Recording is replayed from 0s to 3s in a hidden container
2. **Snapshot Creation**: At exactly 3s, a snapshot is taken of the DOM state
3. **Clean Trim**: Only events from 3s to 12s are included

Result:
- The trimmed recording starts with a synthetic full snapshot at exactly 3s
- No events from before 3s are included
- The DOM state at 3s is perfectly preserved
- Playback begins exactly at the trim point with no buildup

## Best Practices

1. **Time Range Selection**
   - Always validate time ranges before trimming
   - Consider including a buffer around the area of interest

2. **Performance**
   - Trimming large recordings can be memory intensive
   - Consider implementing streaming for very large files

3. **Validation**
   - Always test trimmed recordings for playback
   - Verify that interactions are preserved correctly

## Future Enhancements

1. **True DOM State Reconstruction**
   - Implement full incremental change application
   - Build accurate DOM state at any timestamp

2. **Optimization**
   - Stream processing for large recordings
   - Parallel processing for multiple clips

3. **Advanced Features**
   - Merge multiple clips
   - Time remapping (slow motion, speed up)
   - Event filtering (remove certain types)

## Conclusion

The trimming logic provides a robust way to extract time ranges from rrweb recordings while maintaining playback integrity. By creating synthetic full snapshots at trim points, we ensure that the resulting recordings are self-contained and can be played back independently of the original recording. 